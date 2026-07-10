import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// 基礎設施設定（同 drizzle.config.ts 模式）：next.config 於 build/啟動階段執行，
// 無法 import server-only 的 src/lib/env——此處直接讀環境變數，需與 env.ts 預設一致。
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB) || 50;

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  serverExternalPackages: ["pino"],
  experimental: {
    // middleware 經過的請求 body 預設上限 10MB，會截斷大附件上傳（M-01）；
    // 放寬到單檔上限＋1MB multipart 額外負擔，實際大小仍由 /api/upload 驗證。
    middlewareClientMaxBodySize: `${maxUploadMb + 1}mb`,
  },
};

export default withNextIntl(nextConfig);
