import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { deleteExpiredSessions } from "@/lib/auth/session";
import { JOBS } from "@/lib/jobs/queue";

/**
 * Worker entrypoint（H-01）：與 web 同 codebase、獨立行程（compose worker 服務）。
 * - 消費背景 job（embedding 索引由 H-06 掛入 handler）
 * - cron 排程（G11）：過期 session 清理
 * - graceful shutdown：SIGTERM 完成手上 job 再退出（K8s rolling update 前提）
 */
async function main() {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL });
  boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));
  await boss.start();
  logger.info("worker started");

  // ── cron jobs（G11） ──
  await boss.createQueue(JOBS.cleanupSessions);
  await boss.schedule(JOBS.cleanupSessions, "10 3 * * *", {}, {});
  await boss.work(JOBS.cleanupSessions, async () => {
    await deleteExpiredSessions();
    logger.info("expired sessions cleaned");
  });

  // ── 任務型 job：handler 隨功能 issue 掛入（H-06 embedding 等） ──

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down (graceful)");
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  logger.error({ err: error }, "worker fatal");
  process.exit(1);
});
