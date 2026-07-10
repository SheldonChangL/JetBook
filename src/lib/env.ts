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
