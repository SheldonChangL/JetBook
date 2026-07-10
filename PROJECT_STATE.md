# PROJECT_STATE.md — JetBook 專案狀態

> 每個 issue 完成、或狀態有變（blockers、範圍調整）時必須更新本檔。

## 專案

**JetBook** — 捷揚光電（Jet Opto）內部知識管理系統（類 GitBook）。
Next.js（App Router、TS strict）全端 + PostgreSQL 16/pgvector/pgroonga + Docker Compose；AI RAG 問答（前期 Claude API → 後期 Local LLM，經 Provider 抽象層以 env 切換）；繁體中文預設。

## 目前階段

**M0 完成 ✅；M1 核心垂直切片完成 ✅（登入→建立/編輯/autosave→版本→閱讀→搜尋 全通）。**
已完成 M1：B-01/02/04（認證）、C-01/02（Space/頁面）、B-03（授權）、D-02（儲存管線）、
E-01（版本）、F-01（pgroonga 搜尋）、G-01（App Shell）、D-01（TipTap 編輯器）、G-02（閱讀頁）。
**M1 剩餘**：C-03 頁面樹 UI（#21）、C-04 拖曳搬移（#22）、C-05 slug/301（#23）、C-06 Dashboard（#26）、
C-07 權限管理 UI（#27）、B-05 忘記密碼（#15）、B-06 OIDC stub（#16）、B-07 audit（#17）、B-08 個人設定（#88）、
D-03~D-10 編輯器區塊（slash/程式碼/表格/callout/圖片/附件/Markdown 貼上）、E-02/E-03 版本 UI、
F-02 Cmd+K（#54）、G-03 深色設定頁、G-04 錯誤頁、M-01/M-02 附件、L-01/L-02 後台、
N-01 真 PG 整合測試、N-02 E2E 閘門、N-03 備份。之後 M2（AI/RAG）、M3（協作治理）。

### 環境備忘（跨 session）
- 本機 PG：`docker compose up -d db`（image = pgroonga base + pgvector，已含中文分詞）。
- 遷移：`npm run db:generate && npm run db:migrate`（.env 的 DATABASE_URL 指 127.0.0.1:5432）。
- 測試種子帳號：admin@jet-opto.com.tw / Admin-JetBook-2026（org admin）。
- 行為驗證慣例：`npx tsx --conditions=react-server`（server-only 模組需此 flag）；import server action 模組會拉進 React server context 而失敗，測 DB 邏輯時直接呼叫 lib 層。
- 瀏覽器 E2E：RSC server-action 表單用 `form.requestSubmit()`（`.click()` 常與 hydration 競爭）；改動需 `rm -rf .next` 清快取。
- self-merge：`gh api -X PUT repos/SheldonChangL/JetBook/pulls/<N>/merge -f merge_method=squash`。

## GitHub 執行狀態

- Repo：https://github.com/SheldonChangL/JetBook（private）
- Issues：#1–#93（92 個 task + M4 backlog；task ID ↔ issue 編號對照見 docs/plans/issue-plan.md）
- Milestones：M0（已全數完成）／M1／M2／M3／M4
- 工作流：branch `feature/issue-<n>-<slug>` → PR（Fixes #n）→ squash merge（使用者已授權 self-merge）

## 已完成

### 規劃（docs 全落地，見 initial commit）

- 功能需求 v1.1（94 項）、NFR、系統架構、10 則 ADR、UI 規格 v1.1、審查報告、交付拆解、7 張 HTML mockups

### M0 骨架與基礎設施（10/10，PR #89、#94–#101）

- [x] A-01 Next.js 15 + React 19 + TS strict 骨架（standalone build）
- [x] A-02 Dockerfile（multi-stage 非 root）＋ Compose（proxy/web/db）＋ .env.example
- [x] A-03 `src/lib/env.ts`（Zod 驗證、fail-fast 列缺項）
- [x] A-04 Drizzle ORM + drizzle-kit migration 工作流（db:generate/migrate/check）；CI 加 db:check
- [x] A-05 `/api/healthz`、`/api/readyz`（DB 斷線 503 實測）＋ pino JSON log＋x-request-id
- [x] A-06 CI（lint/typecheck/test/build＋main 建 GHCR image）
- [x] A-07 設計 token（雙模式 CSS 變數、Tailwind v4）＋ Inter/Noto Sans TC/JetBrains Mono self-host
- [x] A-08 核心 UI 元件庫 16 元件（Radix + cmdk）＋ `/design-system` 預覽沙盒（深淺色實測）
- [x] A-09 next-intl 單語系 zh-TW＋ESLint 禁 JSX 硬編碼字串
- [x] A-10 **中文分詞 spike 定案 pgroonga**（14/14 驗收查詢；db image = pgroonga base + pgvector，實建實測）

### M1 MVP（進行中）

- [x] B-01 使用者/Session schema + Argon2id（#11，10/10 真 PG 測試）
- [x] B-02 登入/登出 + 防暴力破解（#12，瀏覽器 E2E + 節流實測）
- [x] B-04 路由保護 + requireSession + returnTo（#14）
- [x] C-01 Space schema（visibility 三態/角色四級）+ CRUD（#19，7/7 權限測試）
- [x] C-02 頁面 schema（鄰接表+fractional index/鎖欄位/slug 歷史/瀏覽）+ CRUD（#20，8/8）
- [x] B-03 授權核心 permission.ts（#13，37 單元 + 8 真 PG，SQL 層過濾 + RAG AI 索引排除）
- [x] D-02 內容儲存管線（三欄同交易同步 + 樂觀鎖 + 編輯鎖，#109，5/5）
- [x] E-01 版本快照（session 合併 + 還原，#110，4/4）
- [x] F-01 全文搜尋（pgroonga 中文分詞 + 權限過濾 + 標題加權，#111，6/6）
- [x] G-01 App Shell 三欄版面（#112，瀏覽器實測）
- [x] D-01 TipTap 編輯器 + autosave + 編輯鎖（#113，E2E + DB 落地）
- [x] G-02 文件閱讀頁（JSON→React 渲染 + 301 + 瀏覽記錄，#114，E2E）
- 測試：Vitest 41（policy 37 + serialize 4 → 實為 policy/serialize 合計 41）；核心邏輯另有多支真 PG 行為驗證腳本
- [ ] M1 剩餘見上「目前階段」清單

## 關鍵已拍板決策（摘要，全文見 ADR）

- C1：軟性編輯鎖（心跳 30s、閒置 5 分釋放、Admin 可搶鎖）＋樂觀版本檢查備援
- C2：v1 直接編輯＋autosave＋自動版本快照，無草稿／發布閘門
- ORM＝Drizzle；佇列＝pg-boss；embedding day-1＝local BGE-M3（1024 維）
- **ADR-007 已定案：中文全文檢索＝pgroonga**（pages 不需 search_tsv 欄位，索引直接建在 text 欄位）
- 兩道閘門：N-02（MVP E2E 全綠才上線）、N-04（RAG 權限隔離測試通過才開放 AI）

## Blockers

無。

## 下一步

1. M1 認證鏈：B-01（#11 users/sessions/groups schema——「schema 一次補齊」）→ B-02 登入 → B-03 authz 唯一入口
2. 與認證鏈並行：G-01 App Shell、M-01 StorageProvider
3. M1 尾聲提前起跑 H-02/H-04/H-05（AI 平台純介面，壓縮 M2 期程）
