import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // 測試環境以空 stub 取代 server-only 守衛
      "server-only": resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // 單元測試環境變數（env.ts fail-fast 所需的最小集合；整合測試由 testcontainers 覆寫）
    env: {
      NODE_ENV: "test",
      BASE_URL: "http://localhost",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
    },
  },
});
