import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_MEMBER, type E2EAccount } from "./accounts";

/**
 * N-02 MVP 冒煙旅程（出貨閘門）。
 * 覆蓋核心垂直切片：登入 → 建立私有 Space → 建立頁面 → 編輯器輸入中文 →
 * 等 autosave「已自動儲存」→ 回閱讀頁驗內容 → Cmd+K 搜尋命中 →
 * 第二位使用者（一般成員）驗證私有 Space 隔離（搜尋不到／清單不可見／直接 URL 404）→ 登出。
 *
 * 每次執行以 RUN_ID 產生唯一名稱，避免跨執行資料互相干擾。
 *
 * 設計取捨：
 * - Space 以 ASCII 命名，slug 為乾淨可讀 kebab（C-05）；純中文名會退化為 `s-xxxx` 短碼，
 *   混用中英則會殘留 CJK，故此處固定 ASCII 以確保路由穩定並用於唯一識別。
 * - 頁面沿用預設標題「未命名頁面」，只在內文輸入中文：改標題會改 slug，
 *   而編輯頁不做 slug 歷史 301，改名觸發的路由重驗會使編輯頁 404（屬 D-01/C-05 範疇，
 *   非本冒煙閘門職責）。以唯一內文標記（RUN_ID）＋唯一 Space 名稱定位本次頁面。
 */
const RUN_ID = Date.now().toString();
const SPACE_NAME = `E2E Smoke Space ${RUN_ID}`;
const DEFAULT_PAGE_TITLE = "未命名頁面";
const PAGE_BODY = `這是冒煙測試的中文內容 ${RUN_ID}`;
// 純 CJK 查詢字：pgroonga（TokenBigram）對中文子字串可靠命中；命中路徑為內文（content_text）
const SEARCH_TERM = "冒煙測試";

const SEARCH_PLACEHOLDER = "搜尋文件或問 AI…";
const PALETTE_NAME = "全域搜尋";

async function login(page: Page, account: E2EAccount): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("公司信箱").fill(account.email);
  await page.getByLabel("密碼", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  // 登入成功導回首頁；App Shell 頂部列 JetBook logo 出現即代表進入已驗證區
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("link", { name: "JetBook" })).toBeVisible();
}

async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: PALETTE_NAME });
  await expect(palette).toBeVisible();
  return palette;
}

test("MVP 冒煙：登入→建空間→建頁→編輯→閱讀→搜尋→私有隔離→登出", async ({
  page,
  browser,
}) => {
  // ── 1) 管理員登入 ──
  await login(page, E2E_ADMIN);

  // ── 2) 建立私有 Space（新建 Space 預設 visibility=private）──
  await page.goto("/spaces");
  await page.getByRole("button", { name: "建立 Space" }).click();
  const createDialog = page.getByRole("dialog", { name: "建立新空間" });
  await createDialog.getByLabel("名稱").fill(SPACE_NAME);
  await createDialog.getByRole("button", { name: "建立 Space" }).click();

  await page.waitForURL(/\/s\/[^/]+$/);
  const spaceSlug = new URL(page.url()).pathname.split("/")[2]!;
  await expect(page.getByRole("heading", { name: SPACE_NAME })).toBeVisible();

  // ── 3) 建立頁面（頁面樹側欄空狀態 CTA）──
  await page.getByRole("button", { name: "建立第一個頁面" }).click();
  await page.waitForURL(/\/s\/[^/]+\/[^/]+\/edit$/);
  const pageSlug = new URL(page.url()).pathname.split("/")[3]!;

  // ── 4) 編輯器：輸入中文內容，等 autosave 落地 ──
  const editorBody = page.locator(".prose-editor");
  await editorBody.click();
  await editorBody.pressSequentially(PAGE_BODY, { delay: 20 });
  // autosave（≥2s debounce）成功後狀態列顯示「已自動儲存」
  await expect(page.getByText("已自動儲存")).toBeVisible();

  // ── 5) 回閱讀頁驗證中文內容（slug 未變，直接導向）──
  await page.getByRole("button", { name: "完成編輯" }).click();
  await page.waitForURL(new RegExp(`/s/${spaceSlug}/${pageSlug}$`));
  await expect(page.getByRole("heading", { name: DEFAULT_PAGE_TITLE })).toBeVisible();
  await expect(page.getByText(PAGE_BODY)).toBeVisible();

  // ── 6) Cmd+K 搜尋命中該頁（以唯一 Space 名稱鎖定本次執行的頁面）──
  {
    const palette = await openPalette(page);
    const searchResp = page.waitForResponse(
      (r) => r.url().includes("/api/search") && r.status() === 200,
    );
    await palette.getByPlaceholder(SEARCH_PLACEHOLDER).fill(SEARCH_TERM);
    await searchResp;
    const hit = palette.locator("[cmdk-item]").filter({ hasText: SPACE_NAME });
    await expect(hit).toBeVisible();
    await hit.click();
    await page.waitForURL(new RegExp(`/s/${spaceSlug}/${pageSlug}$`));
    await expect(page.getByText(PAGE_BODY)).toBeVisible();
  }

  // ── 7) 第二位使用者（一般成員）驗證私有 Space 隔離 ──
  const memberContext = await browser.newContext();
  try {
    const memberPage = await memberContext.newPage();
    await login(memberPage, E2E_MEMBER);

    // 7a) 搜尋不到該頁（getAccessiblePageIds 在 SQL 層過濾，非事後過濾）
    const memberPalette = await openPalette(memberPage);
    const memberSearchResp = memberPage.waitForResponse(
      (r) => r.url().includes("/api/search") && r.status() === 200,
    );
    await memberPalette.getByPlaceholder(SEARCH_PLACEHOLDER).fill(SEARCH_TERM);
    await memberSearchResp;
    await expect(
      memberPalette.locator("[cmdk-item]").filter({ hasText: SPACE_NAME }),
    ).toHaveCount(0);
    await memberPage.keyboard.press("Escape");

    // 7b) 空間清單不含該私有 Space
    await memberPage.goto("/spaces");
    await expect(memberPage.getByText(SPACE_NAME)).toHaveCount(0);

    // 7c) 直接輸入私有 Space URL → 404（私有一律不洩漏存在性）
    await memberPage.goto(`/s/${spaceSlug}`);
    await expect(memberPage.getByText("找不到這個頁面")).toBeVisible();
  } finally {
    await memberContext.close();
  }

  // ── 8) 登出 ──
  await page.getByRole("button", { name: "使用者選單" }).click();
  await page.getByRole("button", { name: "登出" }).click();
  await page.waitForURL(/\/login$/);
  await expect(page.getByRole("button", { name: "登入", exact: true })).toBeVisible();
});
