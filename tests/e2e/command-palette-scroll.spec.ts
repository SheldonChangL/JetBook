import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { E2E_ADMIN, type E2EAccount } from "./accounts";
import { resolveDatabaseUrl } from "./seed";

/**
 * Cmd+K 命令面板捲動回歸（#288）。
 *
 * 咬住的回歸：cmdk 的 `Command.Dialog` 會在 Dialog 內容與我們的子元素之間插入一層無樣式的
 * `[cmdk-root]`。若沒有讓那一層也成為受限的 column flex 容器，`Command.List` 的
 * `flex-1 min-h-0 overflow-y-auto` 全部失效——list 高度＝內容高度、永遠不是捲動容器，
 * 超出 `max-height` 的結果被 layer 的 `overflow:hidden` 裁掉且捲不到，底部鍵盤提示列也被裁掉。
 *
 * 因為要驗的是版面而非內容管線，資料以 SQL 直接種入（僅 title／content_text，供 pgroonga 命中），
 * 這樣才能穩定、快速地造出「結果多於一個畫面」的情境。
 */
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.77.0.35" } });

const RUN_ID = Date.now().toString();
/** 唯一查詢詞：確保命中的就是本次種入的頁面（pgroonga bigram 對中文子字串可靠命中）。 */
const TERM = `捲動驗證${RUN_ID}`;
const SPACE_SLUG = `e2e-palette-scroll-${RUN_ID}`;
const SEED_PAGES = 8;
/**
 * 刻意用短視窗：面板上限 78vh，扣掉工作層列／輸入列／提示列後，8 筆結果一定超出可視高度。
 * 這比塞進幾十頁資料更快，也更貼近使用者回報的情境（結果多於一個畫面）。
 */
const VIEWPORT = { width: 1440, height: 560 };

async function seedSearchableSpace(): Promise<void> {
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  try {
    const user = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      E2E_ADMIN.email,
    ]);
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error("E2E_ADMIN 尚未種入（global-setup 應已建立）");

    const space = await pool.query<{ id: string }>(
      `INSERT INTO spaces (slug, name, visibility, created_by)
       VALUES ($1, $2, 'private', $3) RETURNING id`,
      [SPACE_SLUG, `E2E Palette Scroll ${RUN_ID}`, userId],
    );
    const spaceId = space.rows[0]!.id;
    await pool.query(
      `INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [spaceId, userId],
    );
    for (let i = 1; i <= SEED_PAGES; i += 1) {
      await pool.query(
        `INSERT INTO pages (space_id, position, slug, title, content_md, content_text)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [
          spaceId,
          `a${i}`,
          `palette-scroll-${i}`,
          `${TERM} 結果 ${String(i).padStart(2, "0")}`,
          `${TERM} 的第 ${i} 筆內容。`,
        ],
      );
    }
  } finally {
    await pool.end();
  }
}

async function login(page: Page, account: E2EAccount): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("公司信箱").fill(account.email);
  await page.getByLabel("密碼", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

/** 面板版面量測（layer／list／footer 的實際矩形與捲動狀態）。 */
function readLayout(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>(".archive-command-layer")!;
    const list = document.querySelector<HTMLElement>(".archive-command-list")!;
    const footer = document.querySelector<HTMLElement>(".archive-command-footer")!;
    return {
      viewportHeight: window.innerHeight,
      layerBottom: layer.getBoundingClientRect().bottom,
      layerHeight: layer.getBoundingClientRect().height,
      listTop: list.getBoundingClientRect().top,
      listBottom: list.getBoundingClientRect().bottom,
      listScrollHeight: list.scrollHeight,
      listClientHeight: list.clientHeight,
      listScrollTop: list.scrollTop,
      footerBottom: footer.getBoundingClientRect().bottom,
    };
  });
}

test("命令面板：結果多於一畫面時列表可捲動，提示列不被裁掉", async ({ page }) => {
  await seedSearchableSpace();
  await page.setViewportSize(VIEWPORT);
  await login(page, E2E_ADMIN);

  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "全域搜尋" });
  await expect(palette).toBeVisible();

  const searchResponse = page.waitForResponse(
    (r) => r.url().includes("/api/search") && r.status() === 200,
  );
  await palette.getByPlaceholder("搜尋文件或問 AI…").fill(TERM);
  await searchResponse;
  await expect(palette.locator("[cmdk-item]").first()).toBeVisible();
  await expect(palette.getByText(`顯示全部 ${SEED_PAGES} 筆結果`)).toBeAttached();

  const layout = await readLayout(page);

  // 1) 列表本身是捲動容器（回歸時 scrollHeight === clientHeight）
  expect(layout.listScrollHeight).toBeGreaterThan(layout.listClientHeight);

  // 2) 面板與提示列都在視窗內，且提示列不超出面板（回歸時 footer 被推到 layer 外並被裁掉）
  expect(layout.footerBottom).toBeLessThanOrEqual(layout.layerBottom + 1);
  expect(layout.footerBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.listBottom).toBeLessThanOrEqual(layout.layerBottom + 1);

  // 3) 滾輪真的捲得動
  await page.mouse.move(
    VIEWPORT.width / 2,
    Math.round(layout.listTop + layout.listClientHeight / 2),
  );
  await page.mouse.wheel(0, 400);
  await expect
    .poll(async () => (await readLayout(page)).listScrollTop, { timeout: 5000 })
    .toBeGreaterThan(0);

  // 4) 鍵盤走到最後一項時，選取項會被捲進可視範圍
  for (let i = 0; i < SEED_PAGES + 2; i += 1) await page.keyboard.press("ArrowDown");
  const selectedVisible = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>(".archive-command-list")!;
    const selected = document.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]');
    if (!selected) return null;
    const l = list.getBoundingClientRect();
    const s = selected.getBoundingClientRect();
    return { withinTop: s.top >= l.top - 1, withinBottom: s.bottom <= l.bottom + 1 };
  });
  expect(selectedVisible).not.toBeNull();
  expect(selectedVisible).toEqual({ withinTop: true, withinBottom: true });

  // 5) 結果少時面板不應被撐到上限（清空查詢 → 最近瀏覽，內容遠短於 78vh）
  await palette.getByPlaceholder("搜尋文件或問 AI…").fill("");
  await expect(palette.getByText("顯示全部", { exact: false })).toHaveCount(0);
  await expect
    .poll(async () => (await readLayout(page)).layerHeight, { timeout: 5000 })
    .toBeLessThan(VIEWPORT.height * 0.78 - 1);
});
