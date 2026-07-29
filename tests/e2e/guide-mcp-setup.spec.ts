import { expect, test, type Page } from "@playwright/test";
import { E2E_MEMBER, type E2EAccount } from "./accounts";

/**
 * 登入 rate limit 是 IP 層（5 次/分，`src/lib/rate-limit.ts`），整批 spec 共用同一個桶會互相擠爆
 * （本 spec 的登入曾害後續 spec 被 429 擋下）。比照 #275 給本 spec 獨立來源 IP；
 * dev server 前面沒有 proxy，正式部署由 proxy 覆寫此 header，production 行為不變。
 */
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.77.0.31" } });

/**
 * `/guide#mcp` 接入設定的渲染回歸（#284）。
 *
 * 咬住兩件事：
 * 1. 站內發出的 Claude Desktop 設定**分平台且 Windows 那份可用**——Windows 上 `"command": "npx"`
 *    會被包成未加引號的 `cmd.exe /c C:\Program Files\...` 而啟動失敗，故必須是 `cmd` + `/c` + `npx`。
 *    設定字串本身由 `src/lib/mcp/setup-snippets.test.ts` 完整覆蓋，這裡只確認真的送到頁面上。
 * 2. i18n 鍵齊全：next-intl 缺鍵在 build 期抓不到，只會在渲染時退化成鍵名並吐 console error。
 */
async function login(page: Page, account: E2EAccount): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("公司信箱").fill(account.email);
  await page.getByLabel("密碼", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

test("使用說明頁提供 macOS／Windows 兩份 MCP 設定與跨平台排錯", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await login(page, E2E_MEMBER);
  await page.goto("/guide#mcp");

  const setup = page.locator(".archive-mcp-setup");
  await expect(setup).toBeVisible();

  // 三份片段：Claude Code 指令 + macOS 設定 + Windows 設定
  const snippets = setup.locator(".archive-mcp-snippet");
  await expect(snippets).toHaveCount(3);

  const macConfig = snippets.filter({ hasText: "macOS" }).locator("pre");
  const winConfig = snippets.filter({ hasText: "Windows" }).locator("pre");

  await expect(macConfig).toContainText('"command": "npx"');
  // Windows 必須經 cmd /c，且不得直接以 npx 為 command（本 issue 的回歸點）
  await expect(winConfig).toContainText('"command": "cmd"');
  await expect(winConfig).toContainText('"/c"');
  await expect(winConfig).not.toContainText('"command": "npx"');

  // 兩份都指向頁面標示的本站端點（來自 env.BASE_URL，與測試 server 位址無關）
  const endpoint = (await setup.locator("code").first().innerText()).trim();
  expect(endpoint).toMatch(/^https?:\/\/.+\/api\/mcp$/);
  await expect(macConfig).toContainText(endpoint);
  await expect(winConfig).toContainText(endpoint);

  // 排錯區塊涵蓋三平台
  const troubleshoot = page.locator("#mcp").getByRole("heading", { name: "接不上時怎麼查" });
  await expect(troubleshoot).toBeVisible();
  const items = page.locator("#mcp li").filter({ hasText: /Windows：|macOS：|Linux：/ });
  await expect(items).toHaveCount(3);

  // i18n 缺鍵會渲染成 `mcpSetup.xxx` 之類的鍵名
  await expect(setup).not.toContainText("mcpSetup.");
  await expect(page.locator("#mcp")).not.toContainText("guide.mcp.");
  expect(consoleErrors).toEqual([]);
});
