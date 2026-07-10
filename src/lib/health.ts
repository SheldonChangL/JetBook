import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * 系統依賴健康檢查（L-02，F-ADMIN-03）。
 * 供 /api/readyz 與 /admin/system 健康檢查頁共用；檢查邏輯只放這裡，
 * route/page 一律薄殼呼叫。
 */

export interface HealthCheckResult {
  status: "ok" | "error";
  /** 檢查耗時（成功時提供） */
  latencyMs?: number;
  /** 失敗原因（系統例外訊息，僅供 admin 診斷顯示與 log，非 i18n UI 字串） */
  detail?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** DB 健康：`SELECT 1` ＋往返延遲。 */
export async function checkDatabase(): Promise<HealthCheckResult> {
  const start = performance.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { status: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (error) {
    return { status: "error", detail: errorMessage(error) };
  }
}

/**
 * 儲存健康：UPLOAD_DIR 可寫測試（寫入一個暫存探測檔後立即刪除）。
 * 目錄不存在時先嘗試建立（與 StorageProvider 首次寫入行為一致；
 * volume 唯讀或權限不足會在此暴露為 error）。
 * @param dir 覆寫受測目錄（測試用；預設 env.UPLOAD_DIR）
 */
export async function checkStorage(dir: string = env.UPLOAD_DIR): Promise<HealthCheckResult> {
  const start = performance.now();
  const target = resolve(dir);
  const probe = join(target, `.health-probe-${randomUUID()}.tmp`);
  try {
    await mkdir(target, { recursive: true });
    await writeFile(probe, "jetbook health probe");
    await unlink(probe);
    return { status: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (error) {
    return { status: "error", detail: errorMessage(error) };
  }
}

export type LlmHealth =
  /** 未設定 LLM_PROVIDER：AI 功能關閉（M2 回填連線檢查） */
  | { status: "unconfigured" }
  | { status: "configured"; provider: string };

/** LLM 健康：M1 僅回報是否設定；實際連線檢查於 M2 provider 落地後回填。 */
export function checkLlm(): LlmHealth {
  if (!env.LLM_PROVIDER) return { status: "unconfigured" };
  return { status: "configured", provider: env.LLM_PROVIDER };
}

/** DATABASE_URL 遮罩憑證：只顯示 host（含 port）與 db 名，帳密一律不輸出。 */
export function maskDatabaseUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    return `postgresql://${host}${url.pathname}`;
  } catch {
    // 無法解析時整串遮蔽，避免任何憑證外洩
    return "postgresql://***";
  }
}

export interface EnvSummary {
  nodeEnv: string;
  baseUrl: string;
  /** 已遮罩憑證的 DATABASE_URL */
  databaseUrl: string;
  uploadDir: string;
}

/** 環境摘要（唯讀顯示；秘密一律遮罩，F-ADMIN-03）。 */
export function getEnvSummary(): EnvSummary {
  return {
    nodeEnv: env.NODE_ENV,
    baseUrl: env.BASE_URL,
    databaseUrl: maskDatabaseUrl(env.DATABASE_URL),
    uploadDir: resolve(env.UPLOAD_DIR),
  };
}
