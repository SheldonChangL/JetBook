import { defineConfig } from "drizzle-kit";

// drizzle-kit CLI 不會自動載入 .env；Node 22 內建 loadEnvFile。
// CI／正式環境以環境變數直接注入，缺 .env 不視為錯誤。
try {
  process.loadEnvFile(".env");
} catch {
  // .env 不存在時走既有環境變數
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL 未設定（drizzle-kit 需要，見 .env.example）");
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
