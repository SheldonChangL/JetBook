import "server-only";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { pageEmbeddings, pages, spaces } from "@/lib/db/schema";
import { getEmbeddingProvider, type EmbeddingProvider } from "@/lib/llm";
import { logger } from "@/lib/logger";
import { chunkMarkdown } from "./chunker";

/**
 * 頁面嵌入索引器（H-06，架構 B.7）：embed-page job 的核心邏輯。
 * savePage 交易提交後 enqueue，worker 消費時呼叫本函式：
 *   載頁 → aiIndexingEnabled 檢查 → chunkMarkdown → content_hash 增量比對
 *   → 只重嵌變動 chunk → upsert(page_id, chunk_index) + 刪孤兒。
 *
 * 冪等：以頁面「當下」的 content_md 為準（不依賴 job payload 內容），
 * 因此去抖／重試重跑安全，也能收斂到最新存檔（去抖尾端補跑，H-06 enqueue）。
 * 軟刪／空間軟刪／關閉 AI 索引：清除既有向量（敏感內容不留索引，NFR-COMP-03）。
 */

export type EmbedPageStatus =
  | "indexed" // 已建立/更新向量
  | "skipped-disabled" // 空間關閉 AI 索引 → 清除
  | "skipped-deleted" // 頁面/空間軟刪或已不存在 → 清除
  | "cleared"; // 內容為空 → 清除

export interface EmbedPageResult {
  status: EmbedPageStatus;
  /** 頁面切出的 chunk 總數 */
  chunks: number;
  /** 實際重算 embedding 的 chunk 數（content_hash 變動或新增） */
  embedded: number;
  /** content_hash 命中、沿用既有向量的 chunk 數 */
  reused: number;
  /** 刪除的孤兒 chunk 數（內容變短） */
  removed: number;
}

export interface EmbedPageOptions {
  /** 覆寫嵌入 provider（測試以真 HTTP mock 端點注入；預設走 env 單例）。 */
  provider?: EmbeddingProvider;
  /**
   * 忽略 content_hash 增量，強制重算每一個 chunk 的向量（H-07 全庫重嵌用）。
   * 換嵌入模型時內容不變、content_hash 也不變，若沿用舊向量便無法真正換模型；
   * 故 reindex-all 以 force=true 全量重算。
   */
  force?: boolean;
}

async function clearEmbeddings(pageId: string): Promise<number> {
  const removed = await db
    .delete(pageEmbeddings)
    .where(eq(pageEmbeddings.pageId, pageId))
    .returning({ id: pageEmbeddings.id });
  return removed.length;
}

export async function embedPage(
  pageId: string,
  options: EmbedPageOptions = {},
): Promise<EmbedPageResult> {
  // 頁面 + 所屬空間狀態一次取回（軟刪、AI 索引旗標）。
  const [page] = await db
    .select({
      title: pages.title,
      contentMd: pages.contentMd,
      deletedAt: pages.deletedAt,
      spaceDeletedAt: spaces.deletedAt,
      aiIndexingEnabled: spaces.aiIndexingEnabled,
    })
    .from(pages)
    .innerJoin(spaces, eq(pages.spaceId, spaces.id))
    .where(eq(pages.id, pageId))
    .limit(1);

  // 頁面已硬刪（FK cascade 通常已清；保險再刪一次）。
  if (!page) {
    const removed = await clearEmbeddings(pageId);
    return { status: "skipped-deleted", chunks: 0, embedded: 0, reused: 0, removed };
  }

  // 軟刪（頁或空間）：清除向量，避免軟刪內容仍可語意檢索。
  if (page.deletedAt || page.spaceDeletedAt) {
    const removed = await clearEmbeddings(pageId);
    return { status: "skipped-deleted", chunks: 0, embedded: 0, reused: 0, removed };
  }

  // 空間關閉 AI 索引：清除向量（敏感空間，NFR-COMP-03）。
  if (!page.aiIndexingEnabled) {
    const removed = await clearEmbeddings(pageId);
    return { status: "skipped-disabled", chunks: 0, embedded: 0, reused: 0, removed };
  }

  const chunks = chunkMarkdown(page.title, page.contentMd);

  // 內容為空（無 chunk）：清空既有向量。
  if (chunks.length === 0) {
    const removed = await clearEmbeddings(pageId);
    return { status: "cleared", chunks: 0, embedded: 0, reused: 0, removed };
  }

  // 既有向量的 content_hash（依 chunk_index）：增量比對只重嵌變動者。
  const existing = await db
    .select({ chunkIndex: pageEmbeddings.chunkIndex, contentHash: pageEmbeddings.contentHash })
    .from(pageEmbeddings)
    .where(eq(pageEmbeddings.pageId, pageId));
  // force：視同無既有向量，強制每個 chunk 都重算（換模型全庫重嵌）。
  const existingHashByIndex = options.force
    ? new Map<number, string>()
    : new Map(existing.map((row) => [row.chunkIndex, row.contentHash]));

  const changed = chunks.filter(
    (chunk) => existingHashByIndex.get(chunk.index) !== chunk.contentHash,
  );

  // 只對變動 chunk 打嵌入端點（省算力；相同內容沿用舊向量）。
  const provider = options.provider ?? getEmbeddingProvider();
  const vectors = changed.length ? await provider.embed(changed.map((c) => c.text), "document") : [];

  const validIndexes = chunks.map((c) => c.index);

  await db.transaction(async (tx) => {
    for (let i = 0; i < changed.length; i += 1) {
      const chunk = changed[i]!;
      const embedding = vectors[i]!;
      await tx
        .insert(pageEmbeddings)
        .values({
          pageId,
          chunkIndex: chunk.index,
          contentHash: chunk.contentHash,
          headingPath: chunk.headingPath,
          chunkText: chunk.text,
          tokenCount: chunk.tokenCount,
          embedding,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [pageEmbeddings.pageId, pageEmbeddings.chunkIndex],
          set: {
            contentHash: chunk.contentHash,
            headingPath: chunk.headingPath,
            chunkText: chunk.text,
            tokenCount: chunk.tokenCount,
            embedding,
            updatedAt: new Date(),
          },
        });
    }
    // 刪孤兒：內容變短後，index 超出目前 chunk 範圍的舊列。
    await tx
      .delete(pageEmbeddings)
      .where(
        and(eq(pageEmbeddings.pageId, pageId), notInArray(pageEmbeddings.chunkIndex, validIndexes)),
      );
  });

  const removed = existing.filter((row) => !validIndexes.includes(row.chunkIndex)).length;
  const result: EmbedPageResult = {
    status: "indexed",
    chunks: chunks.length,
    embedded: changed.length,
    reused: chunks.length - changed.length,
    removed,
  };
  logger.debug({ pageId, ...result }, "page embeddings upserted");
  return result;
}
