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
