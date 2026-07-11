import "server-only";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, spaces } from "@/lib/db/schema";
import { getEmbeddingProvider, type EmbeddingProvider } from "@/lib/llm";
import { logger } from "@/lib/logger";
import type { ReindexAllProgress } from "@/lib/jobs/queue";
import { embedPage } from "./indexer";

/**
 * 全庫重嵌（H-07，F-AI-02；ADR-005 維度變更四步流程第 2 步）。
 *
 * 換嵌入模型或維度變更後，全量重建語意索引。設計：
 * - **重用 embedPage**（indexer.ts）為唯一每頁權威路徑：載頁→關閉索引/軟刪→清除、
 *   否則 chunk＋content_hash 增量重嵌。不在此另寫一套每頁邏輯（架構鐵律 #5）。
 * - **分批**（keyset 100 頁/批）遍歷未刪頁面，逐頁處理；進度／失敗清單寫 job output。
 * - **NFR-COMP-03 徹底清除**：先對「關閉 AI 索引」空間批次刪除既有向量（含軟刪頁孤兒），
 *   再逐頁重嵌；被排除空間的內容永不送嵌入端點。
 * - **冪等／可續跑**：以頁面當下 content_md 為準、content_hash 增量沿用，重跑成本低，
 *   中斷後直接再觸發即收斂到最新（無需精細斷點狀態）。
 */

/** 每批載入的頁面數（分批遍歷，不一次載入全庫 id）。 */
export const REINDEX_BATCH_SIZE = 100;
/** 失敗清單樣本上限：避免嵌入端點全程失敗時 job output 無限膨脹（另記 failedCount 全量）。 */
export const FAILED_SAMPLE_CAP = 50;

export interface RunReindexAllOptions {
  /** 覆寫嵌入 provider（測試以真 HTTP mock 端點注入；預設走 env 單例）。 */
  provider?: EmbeddingProvider;
  /** 每批頁面數（預設 REINDEX_BATCH_SIZE；測試可縮小驗證分批）。 */
  batchSize?: number;
  /** 進度回呼（best-effort；worker 端寫入 job output）。 */
  onProgress?: (progress: ReindexAllProgress) => Promise<void> | void;
}

/**
 * NFR-COMP-03：對所有「關閉 AI 索引」空間，徹底清除既有向量（含軟刪頁面的孤兒列，
 * 這些頁面不會被下方未刪頁面遍歷涵蓋）。回傳受影響的空間數。
 */
async function purgeDisabledSpaceEmbeddings(): Promise<number> {
  const disabled = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(eq(spaces.aiIndexingEnabled, false));
  if (disabled.length === 0) return 0;
  await db.execute(sql`
    DELETE FROM page_embeddings
    WHERE page_id IN (
      SELECT p.id FROM pages p
      JOIN spaces s ON s.id = p.space_id
      WHERE s.ai_indexing_enabled = false
    )`);
  return disabled.length;
}

export async function runReindexAll(
  options: RunReindexAllOptions = {},
): Promise<ReindexAllProgress> {
  const batchSize = options.batchSize ?? REINDEX_BATCH_SIZE;
  const progress: ReindexAllProgress = {
    phase: "scanning",
    total: 0,
    done: 0,
    indexed: 0,
    cleared: 0,
    purgedDisabledSpaces: 0,
    failedCount: 0,
    failed: [],
  };
  const report = async () => {
    if (options.onProgress) await options.onProgress({ ...progress, failed: [...progress.failed] });
  };

  try {
    // provider 先解析：未設定 embedding 端點時 fail-fast，不做無謂遍歷。
    const provider = options.provider ?? getEmbeddingProvider();

    // 1. NFR-COMP-03：先徹底清除關閉 AI 索引空間的向量。
    progress.purgedDisabledSpaces = await purgeDisabledSpaceEmbeddings();

    // 2. 未刪頁面總數（進度分母）。
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pages)
      .where(isNull(pages.deletedAt));
    progress.total = countRow?.count ?? 0;
    progress.phase = "indexing";
    await report();

    // 3. keyset 分批遍歷未刪頁面（id 升序游標），逐頁重用 embedPage。
    let cursor: string | null = null;
    for (;;) {
      const batch: { id: string }[] = await db
        .select({ id: pages.id })
        .from(pages)
        .where(cursor ? and(isNull(pages.deletedAt), gt(pages.id, cursor)) : isNull(pages.deletedAt))
        .orderBy(asc(pages.id))
        .limit(batchSize);
      if (batch.length === 0) break;

      for (const { id } of batch) {
        try {
          // force：全庫重嵌的本意是換模型／維度後全量重算，內容不變時亦須重打向量。
          const result = await embedPage(id, { provider, force: true });
          if (result.status === "indexed") progress.indexed += 1;
          else progress.cleared += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          progress.failedCount += 1;
          if (progress.failed.length < FAILED_SAMPLE_CAP) {
            progress.failed.push({ pageId: id, error: message });
          }
          logger.error({ err: error, pageId: id }, "reindex-all：單頁嵌入失敗（續跑）");
        }
        progress.done += 1;
      }

      cursor = batch[batch.length - 1]!.id;
      await report();
    }

    progress.phase = "completed";
    await report();
    logger.info(
      {
        total: progress.total,
        indexed: progress.indexed,
        cleared: progress.cleared,
        purgedDisabledSpaces: progress.purgedDisabledSpaces,
        failedCount: progress.failedCount,
      },
      "reindex-all 完成",
    );
    return progress;
  } catch (error) {
    progress.phase = "failed";
    progress.errorCode = "UNKNOWN";
    progress.errorMessage = "全庫重嵌發生非預期錯誤";
    logger.error({ err: error }, "reindex-all 非預期錯誤");
    await report();
    return progress;
  }
}
