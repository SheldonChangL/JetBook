import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_RESET_ADMIN, E2E_RESET_TARGET, type E2EAccount } from "./accounts";
import { seedAccount } from "./seed";

/**
 * Admin 強制重設密碼路徑的 e2e 覆蓋（#275）。
 *
 * 這塊在 #273 修了兩輪、兩次回歸都靠人工點擊才發現：`src/actions/` 沒有單元測試、
 * 整合測試只測 `src/lib`、e2e 未觸及 `/admin/users`。兩條測試分別咬住兩個結構性行為：
 *
 * 1. **重設自己密碼**：`resetUserPassword` 會撤銷本人**全部** session（含當前這台），
 *    action 必須為當前裝置重建 session 並換新 cookie，否則同一請求內的
 *    `revalidatePath("/admin/users")` 重新渲染時無有效 session → 被導向登入 →
 *    一次性密碼送不到 UI（使用者看到「按了沒反應」）。
 * 2. **重設他人密碼**：對方 session 立刻失效，但伺服器端清不掉對方瀏覽器的 cookie。
 *    帶著殘留 cookie 訪問內頁必須單次轉址停在 `/login` 並能重新登入，
 *    不得與 `requireSession` 的 `redirect("/login")` 互推成迴圈（ERR_TOO_MANY_REDIRECTS）。
 *
 * 帳號隔離：兩條測試都用專用帳號（見 accounts.ts），且每條測試開頭以 seedAccount 重置
 * 密碼與登入節流，對執行順序與 CI retry 免疫。
 */

/**
 * 每個角色一個獨立 context，並帶各自的 x-forwarded-for。
 * 登入 rate limit 是 IP 層（5 次/分，`src/lib/rate-limit.ts`）而本 spec 需要多次登入
 * （重設 → 舊密碼失效 → 新密碼登入），共用同一個 IP 桶會撞上限而偽陽性失敗。
 * dev server 前面沒有 proxy，正式部署由 proxy 覆寫此 header，不影響 production 行為。
 */
async function actorContext(browser: Browser, ip: string): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { "x-forwarded-for": ip },
  });
}

async function login(page: Page, account: E2EAccount, password?: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("公司信箱").fill(account.email);
  await page.getByLabel("密碼", { exact: true }).fill(password ?? account.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "使用者選單" }).click();
  await page.getByRole("button", { name: "登出" }).click();
  await page.waitForURL(/\/login$/);
}

/** 在 /admin/users 找到指定使用者列 → 重設密碼 → 回傳畫面顯示的一次性明文密碼。 */
async function resetPasswordFor(page: Page, account: E2EAccount): Promise<string> {
  await page.goto(`/admin/users?q=${encodeURIComponent(account.email)}`);
  const row = page.locator("tbody tr").filter({ hasText: account.email });
  await expect(row).toHaveCount(1);

  await row.getByRole("button", { name: "重設密碼" }).click();
  const dialog = page.getByRole("dialog", { name: `重設 ${account.name} 的密碼` });
  await expect(dialog.getByText("將產生新的隨機密碼")).toBeVisible();
  await dialog.getByRole("button", { name: "重設密碼" }).click();

  // 一次性密碼必須真的出現在 UI（action 回傳值送達 client）
  await expect(dialog.getByText("新密碼已產生")).toBeVisible();
  const password = (await dialog.locator("code").innerText()).trim();
  expect(password.length).toBeGreaterThanOrEqual(12);

  // 「完成」會關閉 modal 並觸發 router.refresh()：session 沒重建時這裡就會被導向 /login
  await dialog.getByRole("button", { name: "完成" }).click();
  await expect(dialog).toBeHidden();
  return password;
}

test("admin 重設自己密碼：一次性密碼顯示、操作者維持登入、新密碼可登入", async ({ browser }) => {
  await seedAccount(E2E_RESET_ADMIN, "admin");
  const context = await actorContext(browser, "10.77.0.11");
  try {
    const page = await context.newPage();
    await login(page, E2E_RESET_ADMIN);

    const newPassword = await resetPasswordFor(page, E2E_RESET_ADMIN);

    // 維持登入：仍在 /admin/users（沒被踢去 /login），且清單渲染完成
    expect(new URL(page.url()).pathname).toBe("/admin/users");
    await expect(page.getByRole("heading", { name: "使用者管理" })).toBeVisible();

    // 硬重載：驗證換上的新 cookie 在伺服器端真的有效（不只 client 端殘留狀態）
    await page.reload();
    expect(new URL(page.url()).pathname).toBe("/admin/users");
    await expect(page.getByRole("heading", { name: "使用者管理" })).toBeVisible();

    // 舊密碼已失效
    await logout(page);
    await page.getByLabel("公司信箱").fill(E2E_RESET_ADMIN.email);
    await page.getByLabel("密碼", { exact: true }).fill(E2E_RESET_ADMIN.password);
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await expect(page.getByText("信箱或密碼錯誤")).toBeVisible();

    // 一次性新密碼可登入
    await login(page, E2E_RESET_ADMIN, newPassword);
    await expect(page.getByRole("link", { name: "JetBook" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("admin 重設他人密碼：對方 session 失效、殘留 cookie 不成重導向迴圈、新密碼可登入", async ({
  browser,
}) => {
  await seedAccount(E2E_RESET_TARGET, "member");
  const targetContext = await actorContext(browser, "10.77.0.21");
  const adminContext = await actorContext(browser, "10.77.0.22");
  try {
    // 對象先登入，取得有效 session cookie
    const targetPage = await targetContext.newPage();
    await login(targetPage, E2E_RESET_TARGET);
    await targetPage.goto("/settings");
    await expect(targetPage.getByRole("heading", { name: "個人設定" })).toBeVisible();

    // 操作者用 E2E_ADMIN：重設他人密碼不動到操作者自己的密碼，同批其他 spec 不受牽連
    const adminPage = await adminContext.newPage();
    await login(adminPage, E2E_ADMIN);
    const newPassword = await resetPasswordFor(adminPage, E2E_RESET_TARGET);

    // 對象帶著殘留（已失效）cookie 訪問內頁：單次轉址停在 /login，且登入表單可用。
    // 迴圈時 Chromium 會在約 20 跳後以 ERR_TOO_MANY_REDIRECTS 讓 goto 直接 throw。
    const response = await targetPage.goto("/settings");
    expect(new URL(targetPage.url()).pathname).toBe("/login");
    await expect(targetPage.getByRole("button", { name: "登入", exact: true })).toBeVisible();

    let hops = 0;
    let previous = response?.request().redirectedFrom() ?? null;
    while (previous) {
      hops += 1;
      previous = previous.redirectedFrom();
    }
    expect(hops).toBeLessThanOrEqual(2);

    // 對象可用 admin 交付的一次性密碼自行重新登入
    await login(targetPage, E2E_RESET_TARGET, newPassword);
    await expect(targetPage.getByRole("link", { name: "JetBook" })).toBeVisible();
  } finally {
    await targetContext.close();
    await adminContext.close();
  }
});
