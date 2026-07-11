import "server-only";
import { PgBoss, type SendOptions } from "pg-boss";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * 背景佇列（H-01，ADR-003）：pg-boss 以 PostgreSQL 實作可靠 job
 * （SKIP LOCKED、retry、cron），不引入 Redis。web 端 enqueue、worker 端消費；
 * job 持久化於 DB，worker 重啟續跑（NFR-AVAIL-04）。
 */

/** Job 名稱常數（enqueue 與 worker 雙端共用，避免字串漂移）。 */
export const JOBS = {
  /** 頁面嵌入索引（H-06）：{ pageId } */
  embedPage: "embed-page",
  /** 頁面嵌入索引死信佇列（H-06）：重試耗盡後轉入，供人工重驅動，不阻塞編輯 */
  embedPageDeadLetter: "embed-page-dead",
  /** 全庫重嵌（H-07）：{} */
  reindexAll: "reindex-all",
  /** 過期 session 清理（G11，cron） */
  cleanupSessions: "cleanup-sessions",
  /** 回收桶逾期清除（C-08，cron） */
  purgeTrash: "purge-trash",
  /** 孤兒附件回收（M-03，cron）：回收未被引用且逾寬限期的附件（storage 檔＋metadata 列） */
  gcOrphanAttachments: "gc-orphan-attachments",
  /** Zip 批次匯入（J-02）：{ storageKey, fileName, spaceId, parentId, userId } */
  importZip: "import-zip",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

/** embed-page job 的 payload 型別（enqueue 與 worker handler 共用）。 */
export interface EmbedPageJob {
  pageId: string;
}

/** import-zip job 的 payload 型別（enqueue 與 worker handler 共用）。 */
export interface ImportZipJob {
  /** StorageProvider 內暫存的 zip 檔 key（處理完刪除） */
  storageKey: string;
  /** 原始上傳檔名（僅供顯示／稽核） */
  fileName: string;
  spaceId: string;
  /** 匯入目標父節點；null＝根層 */
  parentId: string | null;
  /** 匯入發起者（enqueue 時已驗 page.edit 權限；worker 據此建頁） */
  userId: string;
}

const globalForBoss = globalThis as unknown as { jetbookBoss?: PgBoss };

/** 取得已啟動的 pg-boss 單例（web 端 enqueue 用；worker 端自行管理生命週期）。 */
export async function getBoss(): Promise<PgBoss> {
  if (globalForBoss.jetbookBoss) return globalForBoss.jetbookBoss;
  const boss = new PgBoss({ connectionString: env.DATABASE_URL });
  boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));
  await boss.start();
  globalForBoss.jetbookBoss = boss;
  return boss;
}

/** enqueue 便捷函式：確保 queue 存在後送出。 */
export async function enqueue(
  name: JobName,
  data: object,
  options: SendOptions = {},
): Promise<string | null> {
  const boss = await getBoss();
  await boss.createQueue(name);
  return boss.send(name, data, {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    ...options,
  });
}

/** 每個 boss 實例只需建立一次 embed 佇列（含死信）。 */
const embedQueuesReady = new WeakSet<PgBoss>();

/**
 * 確保 embed-page 與其死信佇列存在（enqueue 與 worker 兩端一致設定 deadLetter，
 * 避免任一端以預設值覆蓋佇列設定）。
 */
export async function ensureEmbedQueues(boss: PgBoss): Promise<void> {
  if (embedQueuesReady.has(boss)) return;
  await boss.createQueue(JOBS.embedPageDeadLetter);
  await boss.createQueue(JOBS.embedPage, { deadLetter: JOBS.embedPageDeadLetter });
  embedQueuesReady.add(boss);
}

/**
 * enqueue 頁面嵌入索引（H-06）：
 * - 去抖：singletonKey=pageId + singletonSeconds 讓高頻 autosave 於同一時間槽合併；
 *   singletonNextSlot 確保尾端存檔改由下一槽補跑（不丟最後一次更新，job 重讀當下內容）。
 * - 韌性：retry + 指數退避 + 死信佇列；嵌入端點暫時不可用時自動重試，耗盡轉死信。
 * 全程與存檔交易解耦（fire-and-forget），呼叫端須容忍 enqueue 失敗以不阻塞編輯。
 */
export async function enqueueEmbedPage(pageId: string): Promise<string | null> {
  const boss = await getBoss();
  await ensureEmbedQueues(boss);
  return boss.send(
    JOBS.embedPage,
    { pageId } satisfies EmbedPageJob,
    {
      singletonKey: pageId,
      singletonSeconds: 2,
      singletonNextSlot: true,
      retryLimit: 5,
      retryBackoff: true,
    },
  );
}

// ── Zip 批次匯入（J-02） ───────────────────────────────────────────

/** import-zip job 執行寬限（大量檔案匯入）；避免長工作被判過期而重跑。 */
const IMPORT_ZIP_EXPIRE_SECONDS = 15 * 60;

/** 確保 import-zip 佇列存在（enqueue 與 worker 兩端一致）。 */
export async function ensureImportZipQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(JOBS.importZip);
}

/**
 * enqueue Zip 匯入 job。**retryLimit=0**：匯入非冪等（部分完成後重跑會重複建頁），
 * 故失敗不自動重試——由 UI 呈現錯誤、使用者重新上傳。expireInSeconds 放寬給大批次。
 */
export async function enqueueImportZip(data: ImportZipJob): Promise<string | null> {
  const boss = await getBoss();
  await ensureImportZipQueue(boss);
  return boss.send(JOBS.importZip, data, {
    retryLimit: 0,
    expireInSeconds: IMPORT_ZIP_EXPIRE_SECONDS,
  });
}

/** 匯入 job 進度／結果報告（寫入 job output；UI 輪詢顯示）。 */
export interface ImportZipProgress {
  phase: "unzipping" | "importing" | "completed" | "failed";
  /** 已處理頁面數 */
  processed: number;
  /** 需建立的頁面總數 */
  total: number;
  createdPages: number;
  uploadedImages: number;
  rewrittenImageLinks: number;
  /** 略過的檔案（未支援類型） */
  skipped: { path: string; reason: string }[];
  /** phase=failed 時的錯誤碼／訊息 */
  errorCode?: string;
  errorMessage?: string;
}

/** pg-boss 內部 schema（預設；queue.ts 未自訂 schema）。 */
const PGBOSS_SCHEMA = "pgboss";

/**
 * 將進度寫入 import-zip job 的 output 欄位（best-effort）。pg-boss 無 job 執行中
 * 更新 output 的公開 API，故直接更新其 job 表 output；失敗只記錄不中斷匯入。
 * job 完成時 pg-boss 會以 handler 回傳值覆寫 output（＝最終報告）。
 */
export async function updateImportZipProgress(
  jobId: string,
  progress: ImportZipProgress,
): Promise<void> {
  try {
    await db.execute(
      sql`UPDATE ${sql.raw(`${PGBOSS_SCHEMA}.job`)} SET output = ${JSON.stringify(progress)}::jsonb
          WHERE name = ${JOBS.importZip} AND id = ${jobId}::uuid`,
    );
  } catch (error) {
    logger.warn({ err: error, jobId }, "更新 import-zip 進度失敗（不中斷匯入）");
  }
}

export interface ImportZipStatus {
  state: "created" | "retry" | "active" | "completed" | "cancelled" | "failed";
  /** 發起匯入的空間（供狀態路由授權：需 page.edit） */
  spaceId: string;
  /** 發起者（供狀態路由授權） */
  startedBy: string;
  output: ImportZipProgress | null;
}

/** 查詢 import-zip job 狀態與進度／結果（UI 輪詢用）。找不到回 null。 */
export async function getImportZipStatus(jobId: string): Promise<ImportZipStatus | null> {
  const boss = await getBoss();
  const job = await boss.getJobById<ImportZipJob>(JOBS.importZip, jobId);
  if (!job) return null;
  const output = job.output as ImportZipProgress | null;
  return {
    state: job.state,
    spaceId: job.data.spaceId,
    startedBy: job.data.userId,
    output: output ?? null,
  };
}

// ── 全庫重嵌（H-07） ───────────────────────────────────────────

/** reindex-all job 執行寬限（大庫全量重嵌）；避免長工作被判過期而重跑。 */
const REINDEX_ALL_EXPIRE_SECONDS = 60 * 60;

/** 全庫重嵌 job 進度／結果報告（寫入 job output；UI 輪詢顯示）。 */
export interface ReindexAllProgress {
  phase: "scanning" | "indexing" | "completed" | "failed";
  /** 需處理的未刪頁面總數（進度分母） */
  total: number;
  /** 已處理頁面數 */
  done: number;
  /** 已（重）建向量的頁面數 */
  indexed: number;
  /** 已清除向量的頁面數（關閉索引／內容為空／軟刪） */
  cleared: number;
  /** 被徹底清除向量的「關閉 AI 索引」空間數（NFR-COMP-03） */
  purgedDisabledSpaces: number;
  /** 失敗頁面總數 */
  failedCount: number;
  /** 失敗頁面樣本（上限見 reindex.ts FAILED_SAMPLE_CAP，避免 output 無限膨脹） */
  failed: { pageId: string; error: string }[];
  /** phase=failed 時的錯誤碼／訊息 */
  errorCode?: string;
  errorMessage?: string;
}

/** 確保 reindex-all 佇列存在（enqueue 與 worker 兩端一致）。 */
export async function ensureReindexAllQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(JOBS.reindexAll);
}

/**
 * enqueue 全庫重嵌 job（H-07，換模型／維度變更後重建，F-AI-02）。
 * - singletonKey 固定為全庫唯一鍵：同時間僅允許一個 reindex-all 在佇列／執行中，
 *   避免重複全量重算彼此干擾。
 * - retryLimit=0：長工作不自動重試；重嵌本身冪等（content_hash 增量），失敗時由
 *   admin 檢視 output 後重新觸發。expireInSeconds 放寬給大庫全量。
 */
export async function enqueueReindexAll(): Promise<string | null> {
  const boss = await getBoss();
  await ensureReindexAllQueue(boss);
  return boss.send(
    JOBS.reindexAll,
    {},
    {
      singletonKey: "reindex-all",
      retryLimit: 0,
      expireInSeconds: REINDEX_ALL_EXPIRE_SECONDS,
    },
  );
}

/**
 * 將進度寫入 reindex-all job 的 output 欄位（best-effort，同 import-zip 模式）。
 * job 完成時 pg-boss 以 handler 回傳值覆寫 output（＝最終報告）。
 */
export async function updateReindexAllProgress(
  jobId: string,
  progress: ReindexAllProgress,
): Promise<void> {
  try {
    await db.execute(
      sql`UPDATE ${sql.raw(`${PGBOSS_SCHEMA}.job`)} SET output = ${JSON.stringify(progress)}::jsonb
          WHERE name = ${JOBS.reindexAll} AND id = ${jobId}::uuid`,
    );
  } catch (error) {
    logger.warn({ err: error, jobId }, "更新 reindex-all 進度失敗（不中斷重嵌）");
  }
}

export interface ReindexAllStatus {
  state: "created" | "retry" | "active" | "completed" | "cancelled" | "failed";
  output: ReindexAllProgress | null;
}

/** 查詢 reindex-all job 狀態與進度／結果（UI 輪詢用）。找不到回 null。 */
export async function getReindexAllStatus(jobId: string): Promise<ReindexAllStatus | null> {
  const boss = await getBoss();
  const job = await boss.getJobById(JOBS.reindexAll, jobId);
  if (!job) return null;
  const output = job.output as ReindexAllProgress | null;
  return { state: job.state, output: output ?? null };
}
