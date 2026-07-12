import "server-only";
import client from "prom-client";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { registry } from "./registry";

/**
 * pg-boss 佇列深度指標（N-05，NFR-OBS-03）。
 *
 * 直接查 `pgboss.job`（pg-boss 的 job 表）依 queue 名稱與 state 分組計數，於每次
 * `/api/metrics` 抓取時刷新——不依賴本 process 是否已啟動 pg-boss，只需 DB 內有
 * pgboss schema（由 web／worker 任一端首次啟動 pg-boss 時建立）。
 *
 * state 涵蓋 created/retry/active（待處理＋執行中，即「佇列深度」）與
 * completed/failed/cancelled（保留期內的近況）；label 基數受限於固定佇列數 × 6 種 state。
 */

/** pg-boss job 表所在 schema（queue.ts 未自訂，採預設 `pgboss`）。 */
const PGBOSS_SCHEMA = "pgboss";

const pgbossJobs = new client.Gauge({
  name: "jetbook_pgboss_jobs",
  help: "pg-boss 佇列中的 job 數，依 queue 名稱與 state 分組（NFR-OBS-03）。",
  labelNames: ["queue", "state"] as const,
  registers: [registry],
});

type JobCountRow = {
  name: string;
  state: string;
  count: number;
};

/**
 * 刷新佇列深度 Gauge：查 pgboss.job 分組計數並覆寫。
 * DB 不可用或 pgboss schema 尚未建立時，重置為空並記 warn——metrics 端點其餘指標照常輸出。
 */
export async function collectQueueDepth(): Promise<void> {
  // 先清空，確保消失的 (queue,state) 組合不留殘值；查詢失敗時也維持「無資料」而非陳舊值。
  pgbossJobs.reset();
  try {
    const result = await db.execute<JobCountRow>(
      sql`SELECT name, state::text AS state, count(*)::int AS count
          FROM ${sql.raw(`${PGBOSS_SCHEMA}.job`)}
          GROUP BY name, state`,
    );
    for (const row of result.rows) {
      pgbossJobs.set({ queue: row.name, state: row.state }, Number(row.count));
    }
  } catch (error) {
    logger.warn({ err: error }, "collectQueueDepth: 讀取 pgboss.job 失敗（略過佇列指標）");
  }
}
