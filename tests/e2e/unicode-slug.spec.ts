import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, type E2EAccount } from "./accounts";

/**
 * Issue #207：中英混合標題產生含 CJK 的 slug（C-05 只對「純」中文退化為 `p-xxxx`），
 * App Router 的 route param 為 percent-encoded，未 decode 前與 DB 內原始字元比對不上 → 404。
 * 本 spec 驗證含 CJK slug 的完整路徑：改名 → 舊 slug 301 → 閱讀頁／編輯頁／版本歷史可開。
 */
const RUN_ID = Date.now().toString();
const SPACE_NAME = `E2E Unicode Slug ${RUN_ID}`;
// 混合中英標題 → slug 保留 CJK（如 `e2e-${RUN_ID}-中文標題`）
const MIXED_TITLE = `E2E ${RUN_ID} 中文標題`;

async function login(page: Page, account: E2EAccount): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("公司信箱").fill(account.email);
  await page.getByLabel("密碼", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

test("Unicode slug：改名為中英混合標題後，301 導向與各頁面均可開啟", async ({ page }) => {
  await login(page, E2E_ADMIN);

  // ── 建立 Space 與頁面（預設標題「未命名頁面」→ slug 為 ASCII 短碼 p-xxxx）──
  await page.goto("/spaces");
  await page.getByRole("button", { name: "建立 Space" }).click();
  const createDialog = page.getByRole("dialog", { name: "建立新空間" });
  await createDialog.getByLabel("名稱").fill(SPACE_NAME);
  await createDialog.getByRole("button", { name: "建立 Space" }).click();
  await page.waitForURL(/\/s\/[^/]+$/);
  const spaceSlug = new URL(page.url()).pathname.split("/")[2]!;

  await page.getByRole("button", { name: "建立第一個頁面" }).click();
  await page.waitForURL(/\/s\/[^/]+\/[^/]+\/edit$/);
  const oldPageSlug = new URL(page.url()).pathname.split("/")[3]!;

  // ── 改名為中英混合標題（blur 觸發 renamePage → slug 轉為含 CJK）──
  const titleInput = page.getByRole("textbox", { name: "輸入標題…" });
  await titleInput.fill(MIXED_TITLE);
  await titleInput.blur();

  // ── 舊 slug 301 → 新 CJK slug 閱讀頁（rename 為非同步 server action，輪詢至生效）──
  await expect(async () => {
    await page.goto(`/s/${spaceSlug}/${oldPageSlug}`);
    await expect(page.getByRole("heading", { name: MIXED_TITLE })).toBeVisible({
      timeout: 2000,
    });
  }).toPass({ timeout: 15_000 });

  const readingPath = decodeURIComponent(new URL(page.url()).pathname);
  expect(readingPath).toContain("中文標題");

  // ── 以含 CJK 的 URL 直接開啟：閱讀頁／版本歷史／編輯頁 ──
  await page.goto(readingPath);
  await expect(page.getByRole("heading", { name: MIXED_TITLE })).toBeVisible();

  await page.goto(`${readingPath}/history`);
  await expect(page.getByRole("heading", { name: /^版本歷史（/ })).toBeVisible();

  await page.goto(`${readingPath}/edit`);
  await expect(page.getByRole("textbox", { name: "輸入標題…" })).toHaveValue(MIXED_TITLE);
});
