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
  /** 全庫重嵌（H-07）：{} */
  reindexAll: "reindex-all",
  /** 過期 session 清理（G11，cron） */
  cleanupSessions: "cleanup-sessions",
  /** 回收桶逾期清除（C-08，cron） */
  purgeTrash: "purge-trash",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

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
