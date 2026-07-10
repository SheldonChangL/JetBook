import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * 整合測試設定（N-01）：真 PG（testcontainers，與正式環境同一 db image）。
 * 與單元測試分離：`npm run test` 快速單元；`npm run test:integration` 跑本檔。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "server-only": resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.int.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup-env.ts"],
    // 共用單一容器與資料庫：檔案序列執行避免資料交叉干擾
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
});
