import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pageEmbeddings, pages, spaces } from "@/lib/db/schema";
import { getAccessiblePageIds, type Actor } from "@/lib/authz/permission";
import { env } from "@/lib/env";
import { getEmbeddingProvider, type EmbeddingProvider } from "@/lib/llm";

/**
 * Hybrid Retriever（I-01，架構 B.7-5；本系統最關鍵安全路徑）。
 *
 * 兩路檢索 → RRF 融合 → top-K chunk：
 *   (a) 全文：pgroonga `&@~` 對 pages.content_text 取 top-20 頁（頁級排名）。
 *   (b) 向量：getEmbeddingProvider().embed(query) → pgvector cosine 對 page_embeddings
 *       over-fetch top-40（R4 降險），保留 top-20 進入融合（chunk 級排名）。
 *
 * 安全鐵律（CLAUDE.md #2、constraints §2、N-04 出貨阻斷）：
 * - 權限一律以 getAccessiblePageIds(user, spaceId?, {requireAiIndexing:true}) 取得可讀
 *   且開啟 AI 索引的 pageId 集合，兩路查詢的 SQL WHERE 直接 `page_id IN (...)` 過濾，
 *   **禁止「先檢索再過濾」**——不可讀內容不得進入結果、context 或 citation。
 * - ai_indexing_enabled=false 的 space 由 requireAiIndexing 於來源即排除。
 *
 * 融合（RRF，Reciprocal Rank Fusion，k=60）：
 * - chunk c（屬頁 p）的分數 = 1/(k+vectorRank(c)) + 1/(k+fulltextRank(p))。
 * - 全文為頁級訊號：其排名投射到該頁所有候選 chunk；命中頁若無向量候選 chunk，
 *   以其起始 chunk（index=0，含標題／首段 context header）作為代表 chunk 併入融合。
 * - 同時命中兩路的 chunk 分數最高（hybrid 命中）；取 top-10 chunk 輸出。
 */

export interface RetrievedChunk {
  pageId: string;
  chunkIndex: number;
  headingPath: string;
  chunkText: string;
  /** RRF 融合分數（越大越相關） */
  score: number;
  title: string;
  spaceSlug: string;
  spaceName: string;
  pageSlug: string;
}

export interface RetrieveOptions {
  /** 限定單一 space（可選）；否則跨所有可讀且開啟 AI 索引的 space。 */
  spaceId?: string;
  /** 輸出 chunk 數上限（預設 10）。 */
  limit?: number;
  /**
   * 檢索模式：
   * - `hybrid`（預設）：全文＋向量兩路 RRF 融合。
   * - `semantic`：僅走向量路（供 I-05 Cmd+K 語意區——與全文區互補，命中近義未含原詞的頁）。
   * 兩模式共用同一權限過濾與向量查詢，語意模式只是略過全文路。
   */
  mode?: "hybrid" | "semantic";
  /** 覆寫嵌入 provider（測試注入；預設走 env 單例）。 */
  provider?: EmbeddingProvider;
}

/** 全文路取回頁數（頁級排名餵 RRF）。 */
const FULLTEXT_LIMIT = 20;
/** 向量路 over-fetch（R4：HNSW 疊高選擇性權限過濾時召回不足，多取再修剪）。 */
const VECTOR_OVERFETCH = 40;
/** 向量路保留進入融合的 chunk 數。 */
const VECTOR_KEEP = 20;
/** RRF 常數 k（越大越平滑高排名間差距，業界慣用 60）。 */
const RRF_K = 60;
/** 預設輸出 chunk 數（架構 top 8–12，取 10）。 */
const DEFAULT_RESULT_LIMIT = 10;

interface Candidate {
  pageId: string;
  chunkIndex: number;
  headingPath: string;
  chunkText: string;
  /** 向量路 1-based 排名（未進向量候選則 undefined）。 */
  vectorRank?: number;
  /** 向量距離（cosine；tie-break 與觀測用）。 */
  distance?: number;
  /** 所屬頁的全文路 1-based 排名（頁未命中全文則 undefined）。 */
  fulltextRank?: number;
}

function candidateKey(pageId: string, chunkIndex: number): string {
  return `${pageId}:${chunkIndex}`;
}

/**
 * Hybrid 檢索：全文＋向量兩路 RRF 融合，權限於 SQL 層過濾。
 * 空查詢、無可讀頁、或兩路皆無命中 → 回空陣列。
 */
export async function retrieve(
  user: Actor,
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const q = query.trim();
  if (!q) return [];

  // 權限＋AI 索引旗標於來源過濾（唯一入口；禁止事後過濾）。
  const accessibleIds = await getAccessiblePageIds(user, options.spaceId, {
    requireAiIndexing: true,
  });
  if (accessibleIds.length === 0) return [];

  const limit = Math.min(Math.max(options.limit ?? DEFAULT_RESULT_LIMIT, 1), 50);
  const mode = options.mode ?? "hybrid";
  const provider = options.provider ?? getEmbeddingProvider();

  // 兩路查詢並行（皆以 accessibleIds 於 SQL WHERE 過濾）。
  // 語意模式略過全文路（fulltextPageIds 留空 → RRF 只計向量分數）。
  const [fulltextPageIds, vectorRows] = await Promise.all([
    mode === "semantic" ? Promise.resolve<string[]>([]) : fulltextPageRanking(q, accessibleIds),
    vectorChunkRanking(q, accessibleIds, provider),
  ]);

  const candidates = new Map<string, Candidate>();

  // 向量候選（保留 top-VECTOR_KEEP）。
  vectorRows.slice(0, VECTOR_KEEP).forEach((row, i) => {
    candidates.set(candidateKey(row.pageId, row.chunkIndex), {
      pageId: row.pageId,
      chunkIndex: row.chunkIndex,
      headingPath: row.headingPath,
      chunkText: row.chunkText,
      vectorRank: i + 1,
      distance: row.distance,
    });
  });

  // 全文頁級排名投射到 chunk。
  const fulltextRankByPage = new Map<string, number>();
  fulltextPageIds.forEach((pageId, i) => fulltextRankByPage.set(pageId, i + 1));

  // 標記已有向量候選 chunk 的頁 → 該頁全部候選 chunk 都繼承全文排名。
  for (const candidate of candidates.values()) {
    const rank = fulltextRankByPage.get(candidate.pageId);
    if (rank !== undefined) candidate.fulltextRank = rank;
  }

  // 全文命中但無任何向量候選 chunk 的頁：補其起始 chunk（index=0）作代表。
  const coveredPages = new Set([...candidates.values()].map((c) => c.pageId));
  const uncoveredPages = fulltextPageIds.filter((id) => !coveredPages.has(id));
  if (uncoveredPages.length > 0) {
    const leadChunks = await leadChunksForPages(uncoveredPages, accessibleIds);
    for (const chunk of leadChunks) {
      candidates.set(candidateKey(chunk.pageId, chunk.chunkIndex), {
        pageId: chunk.pageId,
        chunkIndex: chunk.chunkIndex,
        headingPath: chunk.headingPath,
        chunkText: chunk.chunkText,
        fulltextRank: fulltextRankByPage.get(chunk.pageId),
      });
    }
  }

  if (candidates.size === 0) return [];

  // RRF 融合分數 → 排序（分數同分時距離近者優先，再以 pageId/chunkIndex 穩定排序）。
  const scored = [...candidates.values()].map((c) => {
    const vectorScore = c.vectorRank !== undefined ? 1 / (RRF_K + c.vectorRank) : 0;
    const fulltextScore = c.fulltextRank !== undefined ? 1 / (RRF_K + c.fulltextRank) : 0;
    return { candidate: c, score: vectorScore + fulltextScore };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = a.candidate.distance ?? Number.POSITIVE_INFINITY;
    const dbb = b.candidate.distance ?? Number.POSITIVE_INFINITY;
    if (da !== dbb) return da - dbb;
    if (a.candidate.pageId !== b.candidate.pageId)
      return a.candidate.pageId < b.candidate.pageId ? -1 : 1;
    return a.candidate.chunkIndex - b.candidate.chunkIndex;
  });

  const top = scored.slice(0, limit);
  if (top.length === 0) return [];

  // 為 top chunk 補頁面 metadata（title/slug/spaceSlug）；頁 id 皆在 accessibleIds 內。
  const meta = await pageMetadata(top.map((t) => t.candidate.pageId));

  return top
    .map(({ candidate, score }) => {
      const m = meta.get(candidate.pageId);
      if (!m) return null; // 併發刪頁：略過（防洩漏殘影）
      return {
        pageId: candidate.pageId,
        chunkIndex: candidate.chunkIndex,
        headingPath: candidate.headingPath,
        chunkText: candidate.chunkText,
        score,
        title: m.title,
        spaceSlug: m.spaceSlug,
        spaceName: m.spaceName,
        pageSlug: m.pageSlug,
      } satisfies RetrievedChunk;
    })
    .filter((r): r is RetrievedChunk => r !== null);
}

/** 全文路：pgroonga `&@~` 對 content_text，權限 IN 過濾，pgroonga_score 排序取 top-20 頁。 */
async function fulltextPageRanking(query: string, accessibleIds: string[]): Promise<string[]> {
  const rows = await db.execute<{ page_id: string }>(sql`
    SELECT p.id AS page_id
    FROM ${pages} p
    WHERE p.id IN (${sql.join(
      accessibleIds.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND p.content_text &@~ ${query}
    ORDER BY pgroonga_score(p.tableoid, p.ctid) DESC, p.updated_at DESC
    LIMIT ${FULLTEXT_LIMIT}
  `);
  return rows.rows.map((r) => r.page_id);
}

interface VectorRow {
  pageId: string;
  chunkIndex: number;
  headingPath: string;
  chunkText: string;
  distance: number;
}

/**
 * 向量路：embed(query) → pgvector cosine 距離對 page_embeddings，權限 IN 過濾，
 * over-fetch top-40。以交易內 SET LOCAL 開啟 HNSW iterative scan 並套用 ef_search（R4）。
 */
async function vectorChunkRanking(
  query: string,
  accessibleIds: string[],
  provider: EmbeddingProvider,
): Promise<VectorRow[]> {
  const [vector] = await provider.embed([query], "query");
  if (!vector) return [];
  const literal = `[${vector.join(",")}]`;

  return db.transaction(async (tx) => {
    // R4：高選擇性權限過濾疊 HNSW 時非疊代掃描召回不足 → 啟用 iterative scan；
    // ef_search 依基準調校（env，須 ≥ over-fetch）。SET LOCAL 僅限本交易。
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`);
    await tx.execute(sql.raw(`SET LOCAL hnsw.ef_search = ${env.RAG_HNSW_EF_SEARCH}`));

    const rows = await tx
      .select({
        pageId: pageEmbeddings.pageId,
        chunkIndex: pageEmbeddings.chunkIndex,
        headingPath: pageEmbeddings.headingPath,
        chunkText: pageEmbeddings.chunkText,
        distance: sql<number>`${pageEmbeddings.embedding} <=> ${literal}::vector`,
      })
      .from(pageEmbeddings)
      .where(inArray(pageEmbeddings.pageId, accessibleIds))
      .orderBy(sql`${pageEmbeddings.embedding} <=> ${literal}::vector`)
      .limit(VECTOR_OVERFETCH);

    return rows.map((r) => ({ ...r, distance: Number(r.distance) }));
  });
}

interface LeadChunk {
  pageId: string;
  chunkIndex: number;
  headingPath: string;
  chunkText: string;
}

/** 取指定頁的起始 chunk（index=0）作為全文-only 命中頁的代表 chunk（權限再次 IN 過濾）。 */
async function leadChunksForPages(
  pageIds: string[],
  accessibleIds: string[],
): Promise<LeadChunk[]> {
  const allowed = pageIds.filter((id) => accessibleIds.includes(id));
  if (allowed.length === 0) return [];
  return db
    .select({
      pageId: pageEmbeddings.pageId,
      chunkIndex: pageEmbeddings.chunkIndex,
      headingPath: pageEmbeddings.headingPath,
      chunkText: pageEmbeddings.chunkText,
    })
    .from(pageEmbeddings)
    .where(and(inArray(pageEmbeddings.pageId, allowed), eq(pageEmbeddings.chunkIndex, 0)));
}

interface PageMeta {
  title: string;
  pageSlug: string;
  spaceSlug: string;
  spaceName: string;
}

/** 批次取頁面 metadata（title/slug/spaceSlug/spaceName）供結果回填。 */
async function pageMetadata(pageIds: string[]): Promise<Map<string, PageMeta>> {
  const unique = [...new Set(pageIds)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      pageId: pages.id,
      title: pages.title,
      pageSlug: pages.slug,
      spaceSlug: spaces.slug,
      spaceName: spaces.name,
    })
    .from(pages)
    .innerJoin(spaces, eq(pages.spaceId, spaces.id))
    .where(inArray(pages.id, unique));
  return new Map(
    rows.map((r) => [
      r.pageId,
      { title: r.title, pageSlug: r.pageSlug, spaceSlug: r.spaceSlug, spaceName: r.spaceName },
    ]),
  );
}
