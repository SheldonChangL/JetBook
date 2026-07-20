import "server-only";
import { z } from "zod";
import { parseEmbedDomains } from "./content/embed";
import { parseImportHosts } from "./storage/ssrf";

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

  // ── 維運指標（N-05，NFR-OBS-03/04） ──
  /**
   * `/api/metrics`（Prometheus）的 optional bearer token。端點限內網、無 session：
   * 設定後未帶正確 `Authorization: Bearer <token>` 一律 401；未設定則不驗（信任內網／代理層）。
   */
  METRICS_TOKEN: z.string().optional(),

  // ── 檔案儲存（M-01） ──
  /** 附件儲存根目錄（LocalStorageProvider；換路徑即換儲存根，未來 S3/MinIO 另加實作切換） */
  UPLOAD_DIR: z.string().default("./data/uploads"),
  /** 單檔上傳大小上限（MB） */
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),
  /**
   * 伺服器端圖片匯入（import_attachment_from_url）的來源 host allowlist（逗號分隔，如
   * "redmine.jet-opto.com.tw"）。**未設定＝空白名單：一律拒絕匯入**（預設拒絕，SSRF 防護）。
   * 列入白名單即代表管理者信任該來源，允許其解析到私有網段位址（內網 Redmine 即此情境）；
   * 但 loopback／link-local（含 cloud metadata）／multicast 等一律硬性封鎖，不受白名單影響。
   * 轉換後為正規化的 host 陣列（見 lib/storage/ssrf.ts 的 parseImportHosts）。
   */
  JETBOOK_ATTACHMENT_IMPORT_HOSTS: z
    .string()
    .optional()
    .transform((v) => parseImportHosts(v)),
  /**
   * Office 附件轉 PDF 預覽的轉檔服務（M4-12，issue #216）：Gotenberg HTTP API 位址
   * （compose sidecar 為 http://gotenberg:3000）。未設定＝Office 預覽停用，
   * 附件優雅降級為僅下載；PDF 預覽（M4-11）不受影響。
   */
  PREVIEW_CONVERTER_URL: z.string().url().optional(),

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

  // ── Build metadata（#267；build 階段由 Docker ARG 注入，runtime 唯讀，顯示於 GUI／healthz） ──
  /**
   * 應用版本（package.json version）。未注入時 build-info 模組 fallback 至 package.json
   * （見 src/lib/build-info.ts），故此處為 optional。
   */
  APP_VERSION: z.string().optional(),
  /** 建置 commit（完整 git SHA，CI 帶入 github.sha）；未注入＝本機開發，顯示為 dev。 */
  GIT_COMMIT: z.string().optional(),
  /** 建置時間（ISO-8601 UTC，如 2026-07-17T08:00:00Z）；未注入＝本機開發，留空。 */
  BUILD_TIME: z.string().optional(),
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
