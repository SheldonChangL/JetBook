import "server-only";
import { PgBoss, type SendOptions } from "pg-boss";
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
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

/** embed-page job 的 payload 型別（enqueue 與 worker handler 共用）。 */
export interface EmbedPageJob {
  pageId: string;
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
