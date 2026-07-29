import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, type E2EAccount } from "./accounts";

/**
 * 頁面樹展開可發現性回歸（#286）。
 *
 * 使用者回饋「不知道父頁面可以展開」。這裡咬住四個結構性行為：
 * 1. 小樹首繪即展開——不需任何互動就看得到子頁面。
 * 2. 展開鈕命中區 ≥ 24×24（WCAG 2.5.8），標籤帶子頁數。
 * 3. 收合狀態靜止顯示子頁數（不必 hover 才知道裡面有東西）。
 * 4. 點父頁＝開啟並展開它自己的子頁（使用者最自然的動作就會揭露下一層）。
 * 5. 頭部「全部展開／全部收合」可用。
 *
 * 展開規則本身由 `src/lib/pages/tree-expansion.test.ts` 以純函式完整覆蓋，本 spec 只確認
 * 這些行為真的接到 UI 上。
 */

/**
 * 登入 rate limit 是 IP 層（5 次/分，`src/lib/rate-limit.ts`），整批 spec 共用同一個桶會互相擠爆。
 * 比照 #275／#284 給本 spec 獨立來源 IP；dev server 前面沒有 proxy，正式部署由 proxy 覆寫此
 * header，production 行為不變。
 */
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.77.0.32" } });

const RUN_ID = Date.now().toString();
const SPACE_NAME = `E2E Tree Disclosure ${RUN_ID}`;
const PARENT_TITLE = `父頁面 ${RUN_ID}`;
const CHILD_TITLE = `子頁面 ${RUN_ID}`;
const DEFAULT_PAGE_TITLE = "未命名頁面";

async function login(page: Page, account: E2EAccount): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("公司信箱").fill(account.email);
  await page.getByLabel("密碼", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

/** 以樹列的 ⋯ 選單重新命名（hover 才浮現動作鈕）。 */
async function renameRow(page: Page, from: string, to: string): Promise<void> {
  const row = page.locator(".archive-page-tree-row").filter({ hasText: from });
  await row.hover();
  await row.getByRole("button", { name: "更多動作" }).click();
  await page.getByRole("button", { name: "重新命名", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "重新命名頁面" });
  await dialog.getByLabel("標題").fill(to);
  await dialog.getByRole("button", { name: "儲存" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".archive-page-tree-row").filter({ hasText: to })).toBeVisible();
}

test("頁面樹展開可發現：首繪展開、24px 展開鈕、子頁數、點父頁即展開", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, E2E_ADMIN);

  // ── 建立測試資料：一個 Space、父頁面、其下一個子頁面 ──
  await page.goto("/spaces");
  await page.getByRole("button", { name: "建立 Space" }).click();
  const createDialog = page.getByRole("dialog", { name: "建立新空間" });
  await createDialog.getByLabel("名稱").fill(SPACE_NAME);
  await createDialog.getByRole("button", { name: "建立 Space" }).click();
  await page.waitForURL(/\/s\/[^/]+$/);
  const spaceSlug = new URL(page.url()).pathname.split("/")[2]!;

  await page.getByRole("button", { name: "建立第一個頁面" }).click();
  await page.waitForURL(/\/s\/[^/]+\/[^/]+\/edit$/);
  await page.goto(`/s/${spaceSlug}`);
  await renameRow(page, DEFAULT_PAGE_TITLE, PARENT_TITLE);

  const parentRow = page.locator(".archive-page-tree-row").filter({ hasText: PARENT_TITLE });
  await parentRow.hover();
  await parentRow.getByRole("button", { name: "在此新增" }).click();
  await page.getByRole("button", { name: "頁面", exact: true }).click();
  await page.waitForURL(/\/s\/[^/]+\/[^/]+\/edit$/);
  await page.goto(`/s/${spaceSlug}`);
  // 建資料階段不依賴自動展開，否則自動展開一旦回歸，會以「找不到列」的形式失敗在這裡，
  // 而不是失敗在下面那條針對它的斷言上。
  const expandAllButton = page.getByRole("button", { name: "全部展開" });
  if (await expandAllButton.isVisible()) await expandAllButton.click();
  await renameRow(page, DEFAULT_PAGE_TITLE, CHILD_TITLE);

  // ── 1) 首繪即展開：整頁重新載入、零互動，子頁面就可見 ──
  await page.goto(`/s/${spaceSlug}`);
  const tree = page.getByRole("tree", { name: "頁面" });
  const childItem = tree.getByRole("treeitem", { name: CHILD_TITLE });
  await expect(childItem).toBeVisible();
  // 縮排線標示層級（子頁面 1 層 ⇒ 1 條）
  await expect(page.locator(".archive-tree-guide")).toHaveCount(1);

  // ── 2) 展開鈕：命中區 ≥ 24×24、標籤帶子頁數 ──
  const collapseButton = page.getByRole("button", { name: "收合（1 個子頁面）" });
  await expect(collapseButton).toBeVisible();
  const box = await collapseButton.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(24);
  expect(box!.height).toBeGreaterThanOrEqual(24);

  // ── 3) 收合後：子頁面消失、展開鈕標籤翻轉、靜止顯示子頁數 ──
  await collapseButton.click();
  await expect(childItem).toHaveCount(0);
  await expect(page.getByRole("button", { name: "展開（1 個子頁面）" })).toBeVisible();
  await expect(page.locator(".archive-tree-child-count")).toHaveText("1");

  // ── 4) 點父頁＝開啟並展開（本 issue 的核心回歸點）──
  await tree.getByRole("treeitem", { name: PARENT_TITLE }).click();
  await page.waitForURL(new RegExp(`/s/${spaceSlug}/[^/]+$`));
  await expect(childItem).toBeVisible();

  // ── 5) 頭部全部收合／全部展開 ──
  await page.getByRole("button", { name: "全部收合" }).click();
  await expect(childItem).toHaveCount(0);
  await page.getByRole("button", { name: "全部展開" }).click();
  await expect(childItem).toBeVisible();

  // 展開狀態不影響導航：子頁面仍可開啟（改名後 slug 為 CJK，故以標題斷言而非 URL）
  await childItem.click();
  await expect(page.getByRole("heading", { name: CHILD_TITLE })).toBeVisible();
  await expect(childItem).toHaveAttribute("aria-current", "page");
});
