# CLAUDE.md — JetBook 實作代理指引

> 本檔為 JetBook（Next.js 全端 web 專案）專屬工作流指引，**取代**上層目錄 CLAUDE.md 中針對 Electron 的約束（如 preload/context isolation 等不適用本專案）。其餘上層規則與本檔衝突時，以本檔為準。

## 角色定位

你是 JetBook 的實作代理，以嚴謹資深工程師標準操作：找根因、不留暫時性補丁、每次變更影響最小化。JetBook 是凱銳光電（Jet Opto）的內部知識管理系統（類 GitBook）：Next.js App Router + TypeScript strict 全端、PostgreSQL 16 + pgvector、AI RAG 問答（前期 Claude API、後期 Local LLM，經 Provider 抽象層切換）。

## 開工前必讀

每次 session 開始、動手改任何程式碼之前，依序讀：

1. `PROJECT_STATE.md` — 目前分支、active issue、blockers、下一步
2. `constraints.md` — 產品／安全／架構／相依／工作流約束
3. `definition-of-done.md` — 完成定義（PR 前逐條核對）

涉及規格或架構的工作，再讀對應文件：`docs/specs/`（功能與 NFR）、`docs/architecture/` 與 `ARCHITECTURE_DECISIONS.md`（架構與 ADR）、`docs/design/`（UI 規格）、`docs/plans/`（issue 拆解與依賴）。

## Issue 工作流

1. **一次只做一個 GitHub issue**。開工前把 issue 讀完整（含驗收標準與依賴）。
2. **絕不直推 `main`**，一律 branch → PR。
3. Branch 命名：`feature/issue-<n>-<short-slug>`（例：`feature/issue-12-editor-lock`）。
4. 只實作 issue 範圍內的工作。發現範圍膨脹或不明確：拆成新 issue、更新 `PROJECT_STATE.md`、停止範圍外修改。
5. Commit 格式：`feat(issue-<n>): <一句摘要>`（`fix` / `refactor` / `chore` / `docs` / `test` 同格式）。
   - Subject 一句話；body 用短 bullet 寫「做了什麼／為什麼」，不寫長篇實作細節。
   - 不加 `Co-Authored-By:`、不加 `Generated with Claude Code` 等附加行。
6. 驗證全綠（見下節）後 push，開 PR。**PR body 必含 `Fixes #<n>`** 與驗證結果摘要。

## 驗證要求（全綠才可開 PR）

```bash
npm run lint        # ESLint（typescript-eslint）零錯誤
npm run typecheck   # tsc --noEmit 零錯誤
npm run test        # Vitest（權限/RAG 相關用 testcontainers 跑真 PG）
npm run build       # next build 成功
```

- 權限相關變更（authz、space 權限、session、RAG 過濾）：**必附整合測試**（真 PG），不得只有 unit mock。
- 兩道跨 milestone 閘門不可弱化：**N-02**（MVP E2E 冒煙全綠才上線）、**N-04**（RAG 權限隔離自動化測試通過才開放 AI 功能）。

## 關鍵架構鐵律（違反＝PR 退回）

1. **權限判斷只能在 `src/lib/authz/`**。`permission.ts` 的 `can(user, action, resource)` 與 `getAccessiblePageIds(userId, spaceId?)` 是唯一入口；UI、Server Action、Route Handler、RSC 一律呼叫它，禁止散寫權限邏輯。權限預設拒絕。
2. **RAG／語意檢索必須在 SQL 層 join 權限過濾**（`getAccessiblePageIds` 或等價 join）。禁止「先取回再過濾」；此為出貨阻斷條件（N-04）。
3. **所有設定只能經 `src/lib/env.ts`**（Zod 驗證、缺漏 fail-fast）取得；業務程式碼禁止直接讀 `process.env`。
4. **UI 字串一律進 i18n 訊息檔**（`messages/zh-TW.json`，next-intl），零硬編碼；ESLint 規則強制。
5. **內容三欄位只能在 `savePage` 同一交易內同步**：`pages.content`（TipTap JSON canonical）與衍生的 `content_md`、`content_text`（→ `search_tsv`）必須同交易更新，之後 enqueue embedding job。任何其他寫入路徑（匯入、版本還原、migration 回填）必須重用同一儲存管線，不得旁路。
6. **Server Action / Route Handler 只做薄殼**：驗 session → 驗權限 → 呼叫 `src/lib` 層；商業邏輯一律在 `src/lib`。

## 已拍板決策（不可重開討論）

- **C1**：軟性編輯鎖（`locked_by`/`locked_at`、心跳 30s、閒置 5 分釋放、Admin 可搶鎖）＋樂觀版本檢查備援。
- **C2**：v1 為直接編輯＋autosave＋自動版本快照；**無**草稿／發布閘門（UI 無發布按鈕、無草稿側欄、無僅發布版篩選）。
- ORM 統一 **Drizzle**；佇列統一 **pg-boss**（不引入 Redis）。
- Embedding day-1 使用 **local BGE-M3（1024 維）**，避免日後全庫重嵌。
- 中文分詞（zhparser vs pgroonga）由 **M0 A-10 spike** 定案並產出 ADR。
- 稽核日誌與備份為 **Must/P0**，不可延後。

## 文件同步規則

- **架構影響變更**（schema、模組邊界、技術選型、部署拓撲、安全模型）：必須新增或修訂 `ARCHITECTURE_DECISIONS.md` 的 ADR，並更新 `PROJECT_STATE.md`。
- **每個 issue 完成**：更新 `PROJECT_STATE.md`（current branch、active issue、完成事項、blockers、下一步）。
- 實作與規格出現差異：同步修訂 `docs/specs/`、`docs/plans/` 對應章節，不留文件與程式碼不一致。

## 輸出風格

直接。不過度敘事。做完工作、展示結果、保持專案狀態準確。
