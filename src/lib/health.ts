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

/**
 * DATABASE_URL 遮罩憑證：只顯示 host（含 port）與 db 名，帳密一律不輸出。
 * 不用 `new URL()`——HA 多主機字串（`postgresql://u:p@h1:5432,h2:5432/db`）會讓
 * `new URL()` 拋錯而整串遮蔽，反而看不到主機。改以字串切分：去 query（避免夾帶
 * 敏感參數）、取 authority（第一個 `/` 前）、移除 authority 內最後一個 `@` 前的 userinfo。
 */
export function maskDatabaseUrl(databaseUrl: string): string {
  const prefixMatch = /^postgres(?:ql)?:\/\//.exec(databaseUrl);
  if (!prefixMatch) {
    // 非預期格式一律整串遮蔽，避免任何憑證外洩
    return "postgresql://***";
  }
  const prefix = prefixMatch[0];
  // 去掉 query（避免夾帶密碼等敏感參數後外洩）
  const afterPrefix = databaseUrl.slice(prefix.length).replace(/\?.*$/s, "");
  const slashIdx = afterPrefix.indexOf("/");
  const authority = slashIdx === -1 ? afterPrefix : afterPrefix.slice(0, slashIdx);
  const dbPath = slashIdx === -1 ? "" : afterPrefix.slice(slashIdx);
  const atIdx = authority.lastIndexOf("@");
  const hosts = atIdx === -1 ? authority : authority.slice(atIdx + 1);
  return `${prefix}${hosts}${dbPath}`;
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
