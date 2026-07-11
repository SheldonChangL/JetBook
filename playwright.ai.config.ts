import { defineConfig, devices } from "@playwright/test";

/**
 * AI 問答抽屜 E2E 設定（I-03）。
 *
 * 與 N-02 冒煙設定隔離：獨立埠 3123，webServer 額外注入 `LLM_PROVIDER`
 * 讓 `isLlmConfigured()` 為真、伺服器渲染出 ✦ 入口（NFR-AVAIL-02）。
 * `/api/ai/chat` 的 SSE 回應由測試以 page.route 攔截並餵入確定性事件串，
 * 完整驗證前端對話流（串流渲染／引用／來源卡片／停止／錯誤重試），
 * 不依賴真實 LLM／embedding 端點與已索引內容——真實端點由部署 env 接上。
 */
const PORT = 3123;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /ai-drawer\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    locale: "zh-TW",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `${BASE_URL}/api/healthz`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    // 啟用 AI 入口（僅開關 isLlmConfigured；SSE 由測試攔截，不打真實端點）。
    env: { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "e2e-mock-not-used" },
  },
});
