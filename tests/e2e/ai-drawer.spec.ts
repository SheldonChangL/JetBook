import { expect, test, type Page, type Route } from "@playwright/test";
import { E2E_ADMIN, type E2EAccount } from "./accounts";

/**
 * I-03 AI 問答抽屜 E2E（完整對話流）。
 *
 * 以 page.route 攔截 `/api/ai/chat`，餵入確定性 SSE 事件串，在真實瀏覽器中驗證：
 * ✦／⌘J 開關抽屜、空狀態與免責、串流回答的 Markdown 渲染、內文引用 chip、
 * 來源卡片列、停止生成、錯誤 inline alert 與重試，以及 AI 故障不影響搜尋
 * （NFR-AVAIL-02）。真實 LLM／embedding 端點由部署 env 接上。
 */

const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8" } as const;

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// I-04：來源連結帶最深層 heading 錨點（buildSources 以 encodeURIComponent 編碼）。
const LASER_ANCHOR = encodeURIComponent("光軸校準");

const SOURCES = [
  {
    n: 1,
    pageId: "11111111-1111-1111-1111-111111111111",
    title: "雷射模組安裝指南",
    headingPath: "硬體安裝 › 光軸校準",
    snippet: "開啟低功率校準模式（輸出 5%）後靜置預熱，待溫漂係數連續 3 分鐘低於 0.5% 方可校準…",
    url: `/s/product/laser-install#${LASER_ANCHOR}`,
  },
  {
    n: 2,
    pageId: "22222222-2222-2222-2222-222222222222",
    title: "散熱系統組裝",
    headingPath: "",
    snippet: "環境溫度低於 18 °C 時，模組預熱時間應延長 10 分鐘，並確認風道無遮蔽…",
    url: "/s/product/cooling",
  },
];

const OK_BODY =
  frame("sources", SOURCES) +
  frame("delta", { text: "依據《雷射模組安裝指南》，建議預熱時間如下[1]：\n\n" }) +
  frame("delta", { text: "- **JO-L200**：15 分鐘\n- **JO-L350**：25 分鐘\n\n" }) +
  frame("delta", { text: "穩定後方可進入光軸校準工站[2]。" }) +
  frame("done", { usage: { inputTokens: 40, outputTokens: 9 } });

const QUESTION = "雷射模組的預熱時間要多久？";

async function login(page: Page, account: E2EAccount): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("公司信箱").fill(account.email);
  await page.getByLabel("密碼", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("link", { name: "JetBook" })).toBeVisible();
}

/** 攔截 /api/ai/chat：以可變 responder 讓各測試設定回應。 */
async function mockChat(page: Page, responder: () => (route: Route) => Promise<void>) {
  await page.route("**/api/ai/chat", (route) => responder()(route));
}

test("✦ 入口顯示、⌘J 與點擊開關抽屜、空狀態與免責 caption", async ({ page }) => {
  await login(page, E2E_ADMIN);

  const aiButton = page.getByRole("button", { name: /AI 助手/ }).first();
  await expect(aiButton).toBeVisible();

  // 點擊開啟
  await aiButton.click();
  const drawer = page.getByRole("dialog", { name: "JetBook AI" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("詢問知識庫", { exact: true })).toBeVisible();
  await expect(drawer.getByText("AI 回覆依內部文件生成，請以原文為準")).toBeVisible();
  await expect(drawer.getByText("Enter 送出 · Shift+Enter 換行")).toBeVisible();

  // ⌘J 關閉、再開
  await page.keyboard.press("ControlOrMeta+j");
  await expect(drawer).toBeHidden();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByRole("dialog", { name: "JetBook AI" })).toBeVisible();
});

test("送出問題：串流回答（Markdown）＋內文引用 chip＋來源卡片列", async ({ page }) => {
  await login(page, E2E_ADMIN);
  await mockChat(page, () => async (route) =>
    route.fulfill({ status: 200, headers: SSE_HEADERS, body: OK_BODY }),
  );

  await page.getByRole("button", { name: /AI 助手/ }).first().click();
  const drawer = page.getByRole("dialog", { name: "JetBook AI" });
  await expect(drawer).toBeVisible();

  const input = drawer.getByLabel("輸入問題");
  await input.fill(QUESTION);
  await input.press("Enter");

  // 使用者氣泡
  await expect(drawer.getByText(QUESTION)).toBeVisible();
  // AI 回答（Markdown：段落 + 清單粗體）
  await expect(drawer.getByText("建議預熱時間如下", { exact: false })).toBeVisible();
  await expect(drawer.getByText("JO-L200")).toBeVisible();
  // 內文引用 chip [1][2]
  await expect(drawer.getByRole("button", { name: "來源 1" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "來源 2" })).toBeVisible();
  // 來源卡片列（以連結呈現，導向站內頁面錨點；I-04）
  await expect(drawer.getByText("引用來源")).toBeVisible();
  const card = drawer.getByRole("link", { name: /雷射模組安裝指南/ });
  await expect(card).toBeVisible();
  // 有 heading 的來源帶錨點；無 heading（headingPath 空）的來源退化為頁面頂部。
  await expect(card).toHaveAttribute("href", `/s/product/laser-install#${LASER_ANCHOR}`);
  const card2 = drawer.getByRole("link", { name: /散熱系統組裝/ });
  await expect(card2).toBeVisible();
  await expect(card2).toHaveAttribute("href", "/s/product/cooling");
});

test("串流中顯示狀態列並可停止生成", async ({ page }) => {
  await login(page, E2E_ADMIN);
  // 延遲回應：模擬檢索/生成進行中，讓「停止生成」有可按的時機。
  await mockChat(page, () => async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    try {
      await route.fulfill({ status: 200, headers: SSE_HEADERS, body: OK_BODY });
    } catch {
      // 已被使用者停止（fetch abort）→ 連線取消，忽略。
    }
  });

  await page.getByRole("button", { name: /AI 助手/ }).first().click();
  const drawer = page.getByRole("dialog", { name: "JetBook AI" });
  const input = drawer.getByLabel("輸入問題");
  await input.fill(QUESTION);
  await input.press("Enter");

  // 狀態列：檢索中…
  await expect(drawer.getByText("檢索中…")).toBeVisible();
  const stop = drawer.getByRole("button", { name: "停止生成" }).first();
  await expect(stop).toBeVisible();
  await stop.click();

  // 停止後狀態列消失（回到 idle）
  await expect(drawer.getByText("檢索中…")).toBeHidden();
});

test("錯誤 inline alert 可重試，且 AI 故障不影響搜尋（NFR-AVAIL-02）", async ({ page }) => {
  await login(page, E2E_ADMIN);

  let mode: "error" | "ok" = "error";
  await mockChat(page, () => async (route) => {
    if (mode === "error") {
      await route.fulfill({
        status: 200,
        headers: SSE_HEADERS,
        body: frame("error", { message: "（模擬）AI 回答產生失敗" }),
      });
    } else {
      await route.fulfill({ status: 200, headers: SSE_HEADERS, body: OK_BODY });
    }
  });

  await page.getByRole("button", { name: /AI 助手/ }).first().click();
  const drawer = page.getByRole("dialog", { name: "JetBook AI" });
  const input = drawer.getByLabel("輸入問題");
  await input.fill(QUESTION);
  await input.press("Enter");

  // 錯誤 inline alert + 重試
  const alert = drawer.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("（模擬）AI 回答產生失敗");

  // 重試成功
  mode = "ok";
  await drawer.getByRole("button", { name: "重試" }).click();
  await expect(drawer.getByText("JO-L200")).toBeVisible();
  await expect(drawer.getByRole("alert")).toHaveCount(0);

  // NFR-AVAIL-02：AI 故障期間搜尋照常可用（關抽屜 → ⌘K 開命令面板）
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "JetBook AI" })).toBeHidden();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "全域搜尋" })).toBeVisible();
});

/**
 * I-04 引用跳轉（F-AI-05）：於真實頁面建立 H2 標題，取其 G-05 slug 錨點，
 * 以 mock SSE 讓來源指向該頁錨點，於瀏覽器驗證「點 [n] chip / 點來源卡片
 * → 收合抽屜、導向來源頁錨點、載入時捲動 + 2s 高亮」端到端可用。
 */
test("I-04 引用跳轉：點 [n] chip 與來源卡片導向來源頁錨點並捲動高亮", async ({ page }) => {
  await login(page, E2E_ADMIN);

  const runId = Date.now().toString();
  const spaceName = `I04 Cite Jump ${runId}`;
  const headingText = `校準流程 ${runId}`;

  // 1) 建立私有 Space（ASCII 名確保 slug 乾淨可讀）
  await page.goto("/spaces");
  await page.getByRole("button", { name: "建立 Space" }).click();
  const createDialog = page.getByRole("dialog", { name: "建立新空間" });
  await createDialog.getByLabel("名稱").fill(spaceName);
  await createDialog.getByRole("button", { name: "建立 Space" }).click();
  await page.waitForURL(/\/s\/[^/]+$/);
  const spaceSlug = new URL(page.url()).pathname.split("/")[2]!;

  // 2) 建立頁面並在編輯器加入前置內容 + H2 標題（Markdown「## 」快捷）
  await page.getByRole("button", { name: "建立第一個頁面" }).click();
  await page.waitForURL(/\/s\/[^/]+\/[^/]+\/edit$/);
  const pageSlug = new URL(page.url()).pathname.split("/")[3]!;

  const editorBody = page.locator(".prose-editor");
  await editorBody.click();
  // 前置填充：把標題推到視窗下方，讓「捲動」可被觀察（toBeInViewport）。
  for (let i = 0; i < 16; i += 1) {
    await editorBody.pressSequentially(`前置內容第 ${i} 段 ${runId}`, { delay: 0 });
    await page.keyboard.press("Enter");
  }
  await editorBody.pressSequentially(`## ${headingText}`, { delay: 10 });
  await page.keyboard.press("Enter");
  await editorBody.pressSequentially(`校準流程內文 ${runId}`, { delay: 0 });
  await expect(page.getByText("已自動儲存")).toBeVisible();

  // 3) 回閱讀頁，取得標題真實 id（= G-05 閱讀頁 slug 規則）
  await page.getByRole("button", { name: "完成編輯" }).click();
  const pagePath = `/s/${spaceSlug}/${pageSlug}`;
  await page.waitForURL(new RegExp(`${pagePath}$`));
  const heading = page.getByRole("heading", { level: 2, name: new RegExp(headingText) });
  await expect(heading).toBeVisible();
  const headingId = (await heading.getAttribute("id")) ?? "";
  expect(headingId.length).toBeGreaterThan(0);
  const targetUrl = `${pagePath}#${encodeURIComponent(headingId)}`;

  // 4) mock：來源指向本頁真實錨點
  const sources = [
    {
      n: 1,
      pageId: "00000000-0000-0000-0000-000000000001",
      title: `校準手冊 ${runId}`,
      headingPath: `硬體 › ${headingText}`,
      snippet: "校準流程摘要，開啟低功率模式後靜置預熱…",
      url: targetUrl,
    },
  ];
  const body =
    frame("sources", sources) +
    frame("delta", { text: "請參閱校準流程[1]。" }) +
    frame("done", { usage: { inputTokens: 5, outputTokens: 3 } });
  await mockChat(page, () => async (route) =>
    route.fulfill({ status: 200, headers: SSE_HEADERS, body }),
  );

  const atTarget = (u: URL) =>
    u.pathname === pagePath && decodeURIComponent(u.hash) === `#${headingId}`;

  async function askAndOpenAnswer() {
    await page.getByRole("button", { name: /AI 助手/ }).first().click();
    const drawer = page.getByRole("dialog", { name: "JetBook AI" });
    await expect(drawer).toBeVisible();
    // 對話狀態隨 AppShell 保留：若已有回答則不重送。
    if (!(await drawer.getByRole("button", { name: "來源 1" }).isVisible())) {
      const input = drawer.getByLabel("輸入問題");
      await input.fill("校準怎麼做？");
      await input.press("Enter");
      await expect(drawer.getByRole("button", { name: "來源 1" })).toBeVisible();
    }
    return drawer;
  }

  async function expectJumpedAndHighlighted() {
    await page.waitForURL(atTarget);
    await expect(page.getByRole("dialog", { name: "JetBook AI" })).toBeHidden();
    const jumped = page.getByRole("heading", { level: 2, name: new RegExp(headingText) });
    // G-05 hash 高亮：載入即加 anchor-target-highlight（2s 後移除）→ 銜接確認。
    await expect(jumped).toHaveClass(/anchor-target-highlight/, { timeout: 4000 });
    await expect(jumped).toBeInViewport();
  }

  // 5) 從首頁點內文引用 [n] chip → 導頁 + 捲動高亮
  await page.getByRole("link", { name: "JetBook" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  let drawer = await askAndOpenAnswer();
  await drawer.getByRole("button", { name: "來源 1" }).click();
  await expectJumpedAndHighlighted();

  // 6) client 導回首頁（對話保留），改由點來源卡片 → 同樣導頁 + 捲動高亮
  await page.getByRole("link", { name: "JetBook" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  drawer = await askAndOpenAnswer();
  const card = drawer.getByRole("link", { name: new RegExp(`校準手冊 ${runId}`) });
  await expect(card).toHaveAttribute("href", targetUrl);
  await card.click();
  await expectJumpedAndHighlighted();
});
