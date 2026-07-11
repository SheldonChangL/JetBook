import "server-only";
import { retrieve } from "@/lib/rag/retriever";
import { isEmbeddingConfigured, type EmbeddingProvider } from "@/lib/llm";
import type { Actor } from "@/lib/authz/permission";

export interface SemanticHit {
  pageId: string;
  spaceSlug: string;
  spaceName: string;
  slug: string;
  title: string;
  /** 最相關 chunk 的片段文字（純文字，供搜尋面板顯示脈絡） */
  snippet: string;
  score: number;
}

export interface SemanticSearchOptions {
  spaceId?: string;
  /** 回傳頁數上限（預設 5，Cmd+K 語意區用）。 */
  limit?: number;
  /** semantic＝僅向量路（預設）；hybrid＝全文+向量 RRF。 */
  mode?: "semantic" | "hybrid";
  /** 覆寫嵌入 provider（測試注入）。 */
  provider?: EmbeddingProvider;
}

/** 頁級語意結果的片段字數上限（避免整段 chunk 塞爆面板）。 */
const SNIPPET_MAX = 140;
/** 預設回傳頁數（Cmd+K 語意區 5 筆）。 */
const DEFAULT_PAGE_LIMIT = 5;
/** 每頁可能對應多個 chunk：多取 chunk 再去重成頁，確保湊足 pageLimit。 */
const CHUNK_OVERFETCH_FACTOR = 4;

/**
 * 語意搜尋（I-05，F-AI-06）。頁級結果，供 Cmd+K「語意相關」區與 /api/search?mode=semantic|hybrid。
 *
 * 安全鐵律（CLAUDE.md #2、N-04 出貨閘門）：權限過濾一律走 I-01 `retrieve()`——其於 SQL 層
 * `page_id IN (可讀且開啟 AI 索引)` 過濾，禁止「先取回再過濾」。本函式只做「chunk → 頁去重」
 * 的表現層轉換，不觸碰任何權限判斷，也不放寬 retrieve 的過濾。
 *
 * 未設定 embedding（EMBEDDING_BASE_URL 缺）時回空陣列——呼叫端據此不渲染語意區，
 * 且不讓 getEmbeddingProvider() 的擲錯外洩到使用者流程。
 */
export async function semanticSearch(
  user: Actor,
  query: string,
  options: SemanticSearchOptions = {},
): Promise<SemanticHit[]> {
  const q = query.trim();
  if (!q) return [];
  // provider 已注入（測試）時視為可用；否則需 env 有設定 embedding 端點。
  if (!options.provider && !isEmbeddingConfigured()) return [];

  const pageLimit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE_LIMIT, 1), 20);
  const chunkLimit = Math.min(pageLimit * CHUNK_OVERFETCH_FACTOR, 50);

  const chunks = await retrieve(user, q, {
    spaceId: options.spaceId,
    mode: options.mode ?? "semantic",
    limit: chunkLimit,
    provider: options.provider,
  });

  // chunk 已依融合分數排序：逐一去重成頁，保留每頁最高分 chunk 作代表。
  const seen = new Set<string>();
  const hits: SemanticHit[] = [];
  for (const c of chunks) {
    if (seen.has(c.pageId)) continue;
    seen.add(c.pageId);
    hits.push({
      pageId: c.pageId,
      spaceSlug: c.spaceSlug,
      spaceName: c.spaceName,
      slug: c.pageSlug,
      title: c.title,
      snippet: toSnippet(c.chunkText),
      score: c.score,
    });
    if (hits.length >= pageLimit) break;
  }
  return hits;
}

/** chunk 全文（含 context header 與換行）壓成單行片段並截斷。 */
function toSnippet(chunkText: string): string {
  const flat = chunkText.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX)}…` : flat;
}
