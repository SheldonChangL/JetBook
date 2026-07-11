import "server-only";
import { z } from "zod";
import { parseEmbedDomains } from "./content/embed";

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

  // ── 編輯器 Embed 白名單（D-14，F-EDIT-15） ──
  /**
   * 允許 iframe 嵌入的網域白名單（逗號分隔，如 "youtube.com,youtu.be,figma.com"）。
   * 未設定＝白名單為空：所有嵌入 URL 一律退化為連結卡片（預設拒絕）。
   * 由管理者以部署設定控管（12-factor：白名單即設定；D-14 取捨——不另建 org_settings 欄以免 migration）。
   * 轉換後為已正規化的網域陣列（見 lib/content/embed.ts 的 parseEmbedDomains）。
   */
  EMBED_ALLOWED_DOMAINS: z
    .string()
    .optional()
    .transform((v) => parseEmbedDomains(v)),

  // ── Email／SMTP（B-05；全部 optional，未設 SMTP_HOST 時不寄信，改由 logger 輸出信件內容，僅供開發） ──
  /** SMTP 主機；未設定＝不寄信（開發／CI fallback） */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  /** 直連 TLS（465）為 true；587 STARTTLS 為 false。字串明確比對，避免 coerce 把 "false" 判為 true */
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** 寄件者位址（含顯示名） */
  SMTP_FROM: z.string().default("JetBook <no-reply@jet-opto.com.tw>"),

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
  /**
   * HNSW 向量檢索 `hnsw.ef_search`（I-01，R4 降險）：候選佇列大小，越大召回越高、越慢。
   * 必須 ≥ 向量路 over-fetch（40）；依基準測試調校（NFR-PERF-03），預設 100。
   */
  RAG_HNSW_EF_SEARCH: z.coerce.number().int().positive().default(100),
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
