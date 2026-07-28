import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./accounts";

/**
 * 個人設定頁兩項回歸防護（內網 http 部署實測回報）：
 *
 * 1. document 層不得出現多餘捲動區。`.archive-canvas` 是唯一捲動容器，但頁面內容裡的
 *    Tailwind `sr-only`（position: absolute）若沒有容器當 containing block，會以初始
 *    containing block 定位、逃過 overflow 裁切，把 <html> 的 scrollHeight 撐大 →
 *    使用者往下滑會看到 shell 下方一片空白。
 * 2. 純 HTTP 內網（非安全內容）沒有 navigator.clipboard，複製 Token 走 execCommand 後備。
 *    後備 textarea 必須掛在 Modal 的 focus trap 內，否則焦點被搶回、execCommand 照樣
 *    回傳 true 卻沒寫入剪貼簿（成功 toast 說謊）。此處以移除 navigator.clipboard 模擬
 *    非安全內容，再從同 context 的另一個頁面讀回系統剪貼簿驗證真的寫入。
 */
async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("公司信箱").fill(E2E_ADMIN.email);
  await page.getByLabel("密碼", { exact: true }).fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

test("個人設定頁：內容不撐出 document 層捲動（無空白捲動區）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);

  await page.goto("/settings");
  await expect(page.locator("#api-tokens")).toBeVisible();

  const scroll = await page.evaluate(() => {
    const de = document.documentElement;
    return { clientHeight: de.clientHeight, scrollHeight: de.scrollHeight };
  });
  // 容忍 1px 捨入；超出即代表有元素逃出 .archive-canvas 的裁切
  expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight + 1);
});

test("個人設定頁：非安全內容下複製 Token 確實寫入剪貼簿", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // 模擬純 HTTP 內網：navigator.clipboard 不存在，強制走 execCommand 後備路徑
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto("/settings");

  const tokenName = `e2e-clipboard-${Date.now()}`;
  await page.getByRole("button", { name: "建立 Token" }).click();
  const dialog = page.getByRole("dialog", { name: "建立 API Token" });
  await dialog.getByLabel("名稱（用途）").fill(tokenName);
  await dialog.getByRole("button", { name: "建立 Token" }).click();

  // 建立完成畫面同時含 MCP 設定片段（多個 code／複製鈕），故以專屬 class 鎖定 token 本體
  const tokenCode = dialog.locator(".archive-api-token-plaintext");
  await expect(tokenCode).toBeVisible();
  const token = (await tokenCode.innerText()).trim();
  expect(token).toMatch(/^jbk_/);

  // MCP 自助接入（#282）：設定片段必須帶入這把 token，使用者複製即可用
  await expect(dialog.locator(".archive-mcp-snippet").first()).toContainText(
    `Authorization: Bearer ${token}`,
  );

  // 先把剪貼簿填入哨兵值，確保後續讀到的內容一定來自這次複製
  await page.evaluate(() => {
    const el = document.createElement("textarea");
    el.value = "E2E-CLIPBOARD-SENTINEL";
    document.body.appendChild(el);
    el.focus();
    el.select();
    document.execCommand("copy");
    el.remove();
  });

  await dialog.locator(".archive-api-token-copy").click();
  await expect(page.getByText("Token 已複製到剪貼簿").first()).toBeVisible();

  // 另開一個頁面（未移除 navigator.clipboard）讀回系統剪貼簿
  const reader = await context.newPage();
  await reader.goto("/login");
  const clipboard = await reader.evaluate(() => navigator.clipboard.readText());
  await reader.close();
  expect(clipboard).toBe(token);

  // 收尾：撤銷本次建立的 token，避免測試資料累積
  await dialog.getByRole("button", { name: "關閉" }).first().click();
  const row = page.locator(".archive-api-token-row").filter({ hasText: tokenName });
  await row.getByRole("button", { name: "撤銷" }).click();
  await expect(page.getByText("Token 已撤銷，立即失效").first()).toBeVisible();
});
