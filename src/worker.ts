import { PgBoss, type Job } from "pg-boss";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { deleteExpiredSessions } from "@/lib/auth/session";
import {
  ensureEmbedQueues,
  ensureImportZipQueue,
  JOBS,
  updateImportZipProgress,
  type EmbedPageJob,
  type ImportZipJob,
} from "@/lib/jobs/queue";
import { isEmbeddingConfigured } from "@/lib/llm";
import { embedPage } from "@/lib/rag/indexer";
import { runImportZip } from "@/lib/jobs/import-zip";

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

  // ── 任務型 job：頁面嵌入索引（H-06） ──
  await ensureEmbedQueues(boss);
  await boss.work(JOBS.embedPage, async (jobs: Job<EmbedPageJob>[]) => {
    for (const job of jobs) {
      const { pageId } = job.data;
      // 端點未設定（如 embedding 端點下線期）：略過，不讓 job 失敗堆積死信。
      if (!isEmbeddingConfigured()) {
        logger.debug({ pageId }, "embedding 未設定，略過索引 job");
        continue;
      }
      const result = await embedPage(pageId);
      logger.info({ pageId, ...result }, "page embedding indexed");
    }
  });
  // 死信佇列：重試耗盡的 embed job 轉入此處，僅記錄供人工重驅動（不阻塞編輯）。
  await boss.work(JOBS.embedPageDeadLetter, async (jobs: Job<EmbedPageJob>[]) => {
    for (const job of jobs) {
      logger.error(
        { pageId: job.data?.pageId, jobId: job.id },
        "embed-page job 進入死信佇列（重試耗盡）",
      );
    }
  });

  // ── 任務型 job：Zip 批次匯入（J-02） ──
  await ensureImportZipQueue(boss);
  await boss.work(JOBS.importZip, { batchSize: 1 }, async (jobs: Job<ImportZipJob>[]) => {
    // batchSize=1：每次僅取一個匯入 job；回傳最終報告寫入 job output。
    const job = jobs[0];
    if (!job) return;
    return runImportZip(job.data, {
      onProgress: (progress) => updateImportZipProgress(job.id, progress),
    });
  });

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
