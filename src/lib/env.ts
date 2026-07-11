import "server-only";
import { z } from "zod";

/**
 * 環境變數唯一入口（12-factor）。
 * 業務程式碼禁止直接讀 process.env——一律 `import { env } from "@/lib/env"`。
 * 缺漏或格式錯誤在首次載入時 fail-fast，並列出所有缺項。
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** 對外 base URL（含 protocol，反向代理後的位址） */
  BASE_URL: z.url(),
  /** PostgreSQL 連線字串 */
  DATABASE_URL: z.string().startsWith("postgresql://"),

  // ── 檔案儲存（M-01） ──
  /** 附件儲存根目錄（LocalStorageProvider；換路徑即換儲存根，未來 S3/MinIO 另加實作切換） */
  UPLOAD_DIR: z.string().default("./data/uploads"),
  /** 單檔上傳大小上限（MB） */
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),

  // ── OIDC SSO（B-06 預留；全部 optional，未設定時停用 SSO——路由回 404、登入頁不顯示按鈕） ──
  /** IdP issuer URL（OIDC discovery 起點，如 https://idp.example.com） */
  AUTH_OIDC_ISSUER: z.url().optional(),
  AUTH_OIDC_CLIENT_ID: z.string().optional(),
  AUTH_OIDC_CLIENT_SECRET: z.string().optional(),
  /** callback redirect_uri；未設定時由 BASE_URL + /api/auth/oidc/callback 推導 */
  AUTH_OIDC_REDIRECT_URI: z.url().optional(),

  // ── AI Provider（M2；全部 optional，未設定時 AI 功能不可用但系統正常運作，NFR-AVAIL-02） ──
  /** chat LLM 供應商；未設定＝AI 功能關閉 */
  LLM_PROVIDER: z.enum(["anthropic", "openai-compat"]).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_PRIMARY: z.string().default("claude-sonnet-5"),
  ANTHROPIC_MODEL_LIGHT: z.string().default("claude-haiku-4-5"),
  /** OpenAI-compatible endpoint（Ollama/vLLM；後期 Local LLM，NFR-COMP-01） */
  OPENAI_COMPAT_BASE_URL: z.url().optional(),
  OPENAI_COMPAT_MODEL_PRIMARY: z.string().optional(),
  OPENAI_COMPAT_MODEL_LIGHT: z.string().optional(),
  /** Embedding（ADR-005：day-1 local BGE-M3 1024 維；未設定＝語意索引關閉） */
  EMBEDDING_BASE_URL: z.url().optional(),
  EMBEDDING_MODEL: z.string().default("bge-m3"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1024),
  EMBEDDING_QUERY_PREFIX: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`環境變數驗證失敗（檢查 .env，範本見 .env.example）：\n${details}`);
  }
  return result.data;
}

export const env: Env = loadEnv();
