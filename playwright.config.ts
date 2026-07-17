import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E 設定（N-02，MVP 出貨閘門）。
 * webServer 起 `next dev`（自動載入 .env）於固定埠 3121，baseURL 指向同一位址。
 * dev 模式下 session cookie 非 Secure，登入可經 http://127.0.0.1 正常運作。
 */
const PORT = 3121;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests/e2e",
  // AI 抽屜 E2E 需 LLM 入口啟用，走獨立設定（playwright.ai.config.ts，埠 3123），此處排除。
  testIgnore: /ai-drawer\.spec\.ts$/,
  // 冒煙旅程有前後依賴（建 space→建頁→搜尋），單一 worker 串行執行
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  // dev 首次編譯各路由較慢，放寬單案與斷言逾時
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
    env: { UI_V2_ROLLOUT: "on" },
    // /api/healthz 為免驗證 200 存活探針，作為 dev server 就緒判斷
    url: `${BASE_URL}/api/healthz`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
