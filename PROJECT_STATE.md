# PROJECT_STATE.md — JetBook 專案狀態

> 每個 issue 完成、或狀態有變（blockers、範圍調整）時必須更新本檔。

## 專案

**JetBook** — 捷揚光電（Jet Opto）內部知識管理系統（類 GitBook）。
Next.js（App Router、TS strict）全端 + PostgreSQL 16/pgvector/pgroonga + Docker Compose；AI RAG 問答（前期 Claude API → 後期 Local LLM，經 Provider 抽象層以 env 切換）；繁體中文預設。

## 目前階段

**M0 完成 ✅，M1 MVP 進行中（認證＋Space/頁面骨架＋授權核心已完成）。**
下一個：D-01 TipTap 編輯器（#32）→ D-02 儲存管線（#33）→ E-01 版本（#49）→ F-01 搜尋（#53）→ G-01/G-02 Shell/閱讀。

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
- [ ] D-01 編輯器 → D-02 儲存管線 → E-01 版本 → F-01 搜尋 → G-01/02 Shell/閱讀 → L-01 後台 → N-02 E2E 閘門

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
