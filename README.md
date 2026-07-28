# JetBook

> 凱銳光電（Jet Opto）內部知識管理系統 —— 類 GitBook 的全端 web 應用，內建 AI RAG 知識問答。
> Next.js（App Router、TypeScript strict）· PostgreSQL 16 + pgroonga + pgvector · Docker Compose · 繁體中文優先。

**狀態：v1 商品化完成，M4 第一批已上線。** M0–M3 全數交付，兩道出貨閘門（MVP E2E 冒煙、RAG 權限隔離）通過，CI 全綠；M4 第一批（REST API v1、MCP Server、Word 匯入、Email 通知、CSV 批次建立使用者等 8 項）已合併。功能對標 GitBook，程式碼全數原創（僅使用 MIT/Apache 授權之開源函式庫）。

---

## 這是什麼

JetBook 是一套自建、可自架的內部文件與知識庫系統：以 Space 組織文件、樹狀頁面結構、區塊編輯器（TipTap）即寫即存並自動快照版本、中文全文搜尋，並可串接 LLM 提供「引用可跳轉」的 RAG 知識問答。前期以 Claude API 提供 AI 能力，之後可經 Provider 抽象層無痛切換為公司內部 Local LLM（OpenAI-compatible），embedding 自 day-1 即用 local BGE-M3，內容不外流。

## 核心功能

- **組織與頁面**：單一工作區下多個 Space；頁面樹（鄰接表 + fractional index、可拖曳搬移、跨 Space 移動/複製）；Space/頁面 emoji 圖示；slug 歷史與 301 轉址；回收桶（軟刪除）與 Space 封存。
- **編輯器**：TipTap 區塊編輯器（H1–H3、清單/待辦、程式碼高亮、表格、圖片、附件、Callout、Tabs/摺疊/Stepper、Mermaid、白名單 embed）；slash 選單、Markdown 貼上；軟性編輯鎖（心跳 30s、閒置 5 分釋放、Admin 可搶）＋樂觀版本檢查防衝突。
- **版本**：autosave 自動快照、版本檢視與還原、中文字級 diff。
- **搜尋**：pgroonga 中文分詞全文搜尋（標題加權）＋ Cmd+K 命令面板；附件檔名搜尋；AI 開啟時併語意搜尋。
- **AI（RAG）**：LLM/Embedding Provider 抽象層（Anthropic ↔ OpenAI-compatible，env 切換）；增量嵌入索引管線（pg-boss）；Hybrid 檢索（pgroonga + pgvector，RRF）；SSE 串流問答，回答附 `[n]` 引用並可跳至來源頁對應區塊；每人每日用量配額與稽核。
- **協作治理**：留言、通知（站內＋Email，個人逐類開關）、@mention 與頁面連結、群組授權、寫作輔助、匯入（Markdown/Zip/Word .docx）與匯出（Markdown）。
- **對外整合**：REST API v1（個人 API Token Bearer 認證、唯讀端點、OpenAPI 文件頁 `/api-docs`）；內建 MCP Server（`/api/mcp`），讓 Claude 等 AI 助理直接搜尋與閱讀知識庫（見下方[「REST API 與 MCP」](#rest-api-與-mcp)）。
- **權限**：組織角色（admin/member）＋ Space 四級角色（admin/editor/commenter/viewer）＋ 三態可見性（private/org_read/org_write）＋ 群組掛載；預設拒絕。
- **管理後台**：使用者（搜尋/狀態篩選/分頁、CSV 批次建立——相容 Redmine 匯出）、群組、Space、AI 用量、稽核日誌、系統健康。
- **維運**：`/api/healthz`、`/api/readyz`、Prometheus `/api/metrics`；結構化 JSON 日誌（pino）＋ request id；每小時 pg_dump 備份 sidecar（RPO ≤ 1h）。

## 技術棧

| 領域       | 選型                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| 框架       | Next.js 15（App Router、standalone）、React 19、TypeScript 5.9 strict                  |
| 樣式 / UI  | Tailwind CSS v4（雙模式 CSS 變數）、Radix UI、cmdk、Lucide、self-host 字型             |
| i18n       | next-intl（單語系 zh-TW，ESLint 強制字串進訊息檔）                                     |
| 資料庫     | PostgreSQL 16 + **pgroonga**（中文全文檢索）+ **pgvector**（1024 維 HNSW 向量檢索）    |
| ORM / 遷移 | Drizzle ORM + drizzle-kit（版本化 migration，獨立部署步驟）                            |
| 佇列       | pg-boss（複用 PostgreSQL，不引入 Redis）                                               |
| 編輯器     | TipTap 3 / ProseMirror（JSON 為 canonical 內容格式）                                   |
| 認證       | Argon2id（@node-rs/argon2）＋ DB-backed opaque session；OIDC/SSO 預留（openid-client） |
| AI         | @anthropic-ai/sdk；OpenAI-compatible（vLLM/Ollama）；embedding 建議 local BGE-M3       |
| 觀測       | pino（JSON log）、prom-client（Prometheus 指標）                                       |
| 測試       | Vitest（單元）、testcontainers（真 PG 整合）、Playwright（E2E 冒煙）                   |
| 部署       | Docker Compose（Caddy proxy / web / worker / db / backup），未來可遷 K8s               |

## 系統架構

```
                         ┌───────────────────────────────┐
   使用者 ──HTTPS──▶ proxy(Caddy) ──▶ web (Next.js: RSC / Server Actions / Route Handlers)
                         │                        │
                         │                        ├── src/lib/authz  ← 唯一權限入口（預設拒絕）
                         │                        ├── src/lib/*      ← 商業邏輯（薄殼只驗 session→權限→呼叫）
                         │                        └── enqueue jobs ─┐
                         │                                          │
                    worker (pg-boss) ◀───────────────────────────┘  背景：嵌入索引、匯入、cron、GC
                         │                        │
                         ▼                        ▼
                   PostgreSQL 16          StorageProvider（local 檔案系統 → 未來 S3/MinIO）
              （pgroonga + pgvector）
                         ▲
                    backup sidecar（每小時 pg_dump -Fc + uploads 鏡像）
```

- **web / worker 同一 image、不同 entrypoint**：web 跑 `server.js`（standalone），worker 跑 `dist/worker.js`。
- **內容三欄同交易同步**：`pages.content`（TipTap JSON canonical）與衍生的 `content_md`、`content_text` 只在 `savePage` 同一交易內更新，之後 enqueue embedding job。
- **RAG 權限在 SQL 層過濾**：語意/全文檢索一律 join `getAccessiblePageIds`，杜絕「先取回再過濾」——此為 AI 功能出貨阻斷條件（見下方閘門 N-04）。

架構決策全文見 [`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md)（ADR-001 ～ ADR-011）與 [`docs/architecture/`](docs/architecture/)。

## 快速開始（Docker Compose）

需求：Docker + Docker Compose。

```bash
# 1. 準備環境變數
cp .env.example .env
#   至少設定 POSTGRES_PASSWORD、BASE_URL；其餘依需要開啟（AI／SSO／SMTP 見 .env.example 註解）

# 2. 起站（proxy / web / worker / db / backup 五服務）
docker compose up -d --build

# 3. 套用資料庫遷移（首次與每次 schema 變更後執行）
#    容器內 db 綁 127.0.0.1:5432，本機 CLI 可直接連
npm ci
npm run db:migrate

# 4. 建立第一個管理員（全新資料庫的引導步驟，詳見下節）
JETBOOK_ADMIN_EMAIL=admin@jet-opto.com.tw \
JETBOOK_ADMIN_PASSWORD='請改成至少10碼的強密碼' \
JETBOOK_ADMIN_NAME='系統管理員' \
npm run db:seed-admin
```

打開 `BASE_URL`（預設 `http://localhost`）即可登入。健康檢查：`GET /api/healthz`、`GET /api/readyz`。

> AI 入口在未設定 `LLM_PROVIDER` 時自動隱藏，其餘功能不受影響（優雅降級）。

## 建立第一個管理員

v1 沒有公開註冊路由，本地帳號的 `createUser` 需既有 org admin 才能呼叫，OIDC JIT 佈建的使用者預設為 `member`。因此**全新資料庫需要一個帶外引導入口**產生第一個 admin，之後所有帳號一律經 `/admin/users` 建立。

```bash
# 讀 DATABASE_URL（或 .env），建立/升級指定帳號為 org admin
JETBOOK_ADMIN_EMAIL=admin@jet-opto.com.tw \
JETBOOK_ADMIN_PASSWORD='至少10碼強密碼' \
JETBOOK_ADMIN_NAME='系統管理員' \
npm run db:seed-admin
```

腳本 [`scripts/seed-admin.mjs`](scripts/seed-admin.mjs) 只用既有相依（`pg` + `@node-rs/argon2`，Argon2id 參數與 `src/lib/auth/password.ts` 一致），不經 `src/lib`、不需 build。**冪等**：email 已存在時會升為 admin、啟用並重設密碼（可用於救回被鎖死的後台）。登入後請至個人設定自行變更密碼。

## 本地開發

```bash
npm ci
docker compose up -d db          # 只起資料庫（pgroonga + pgvector）
npm run db:migrate               # .env 的 DATABASE_URL 指向 127.0.0.1:5432
npm run db:seed-admin            # 見上節（帶入 JETBOOK_ADMIN_* 環境變數）
npm run dev                      # http://localhost:3000
```

其他常用指令：`npm run db:generate`（依 schema 變更產生 migration）、`npm run db:studio`（Drizzle Studio）、`npm run build:worker`（打包 worker）。

## 環境變數

所有設定**只能**經 [`src/lib/env.ts`](src/lib/env.ts)（Zod 驗證、缺漏 fail-fast）取得，業務程式碼禁止直接讀 `process.env`。完整清單與註解見 [`.env.example`](.env.example)。重點：

| 變數                                                                   | 必填 | 說明                                                                             |
| ---------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| `BASE_URL`                                                             | ✅   | 對外 base URL（含 protocol）                                                     |
| `DATABASE_URL`                                                         | ✅   | PostgreSQL 連線字串（須 `postgresql://` 前綴）                                   |
| `POSTGRES_PASSWORD`                                                    | ✅   | compose db 密碼                                                                  |
| `LLM_PROVIDER`                                                         | —    | `anthropic` \| `openai-compat`；未設定＝AI 關閉                                  |
| `ANTHROPIC_API_KEY` / `OPENAI_COMPAT_BASE_URL`                         | —    | 對應 provider 的憑證/端點                                                        |
| `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS`      | —    | 語意索引（建議 local BGE-M3，1024 維）                                           |
| `AUTH_OIDC_ISSUER` / `AUTH_OIDC_CLIENT_ID` / `AUTH_OIDC_CLIENT_SECRET` | —    | 啟用 SSO；未設定則授權路由 404、登入頁不顯示按鈕                                 |
| `SMTP_*`                                                               | —    | 忘記密碼／Email 通知／歡迎信寄送；未設定則不寄信、信件內容輸出到 log（僅供開發） |
| `METRICS_TOKEN`                                                        | —    | `/api/metrics` 的 Bearer 權杖；未設定則不驗（信任內網）                          |
| `UPLOAD_DIR` / `MAX_UPLOAD_MB` / `EMBED_ALLOWED_DOMAINS` / `BACKUP_*`  | —    | 附件、embed 白名單、備份保留策略                                                 |

## 啟用 AI 功能

1. **Embedding（day-1 即用 local，內容不外流）**：設 `EMBEDDING_BASE_URL` 指向內部 BGE-M3 端點（vLLM/Ollama）、`EMBEDDING_DIMENSIONS=1024`。
2. **Chat**：前期 `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`；之後切內部 Local LLM 只需改為 `LLM_PROVIDER=openai-compat` + `OPENAI_COMPAT_BASE_URL`（Provider 抽象層已就位）。
3. 於 `/admin/ai` 測試連線，並對既有內容執行全庫重嵌。

## REST API 與 MCP

兩者共用**個人 API Token**（「個人設定 → API Token」建立，`jbk_` 開頭，HTTP Bearer 認證）。工具與端點的可見範圍完全等於 token 擁有者在 JetBook 的權限；token 於個人設定撤銷後立即失效。

- **REST API v1**：唯讀端點（空間清單、頁面樹、頁面內容、搜尋）；互動式 OpenAPI 文件見 `/api-docs`。
- **MCP Server**：`https://<網域>/api/mcp`（streamable HTTP），讓 Claude 等 AI 助理直接搜尋、閱讀與撰寫知識庫——唯讀工具 `list_spaces`／`search_pages`／`read_page`，寫入工具（token 需勾「允許寫入」）`create_page`／`update_page`／`move_page`／`delete_page`／`create_space`／`update_space`／`set_space_member`／`import_attachment_from_url`。使用者接入走站內「使用說明」頁（`/guide#mcp`，設定片段自動填入本站網域、依部署自動補 `--allow-http`，並分別給出 macOS 與 Windows 兩份 Claude Desktop 設定；建立 token 完成畫面直接給出含 token 的設定）；完整參考（工具速查、SSRF 白名單、跨平台疑難排解）見 [`docs/guides/mcp-server.md`](docs/guides/mcp-server.md)。

> **安全鐵律：每位使用者用自己的 token。** 共用 token（尤其 admin 的）等於把私有空間內容經 AI 助理外洩給無權者。

## 驗證與測試

開 PR 前四道全綠（與 CI 一致）：

```bash
npm run lint          # ESLint（typescript-eslint），零錯誤
npm run typecheck     # tsc --noEmit，零錯誤
npm run test          # Vitest 單元測試
npm run build         # next build
```

進一步：

```bash
npm run test:integration   # testcontainers 起真 PG（pgroonga+pgvector）跑整合測試
npm run test:e2e           # Playwright E2E 冒煙（需先起 db 並套遷移）
```

規模：單元測試 468、整合測試 236（真 PG）、Playwright E2E 全旅程冒煙。CI 於 `.github/workflows/ci.yml` 定義 Validate 與 E2E 兩個必過 job。

**兩道出貨閘門（不可弱化）**：

- **N-02**：MVP E2E 冒煙全綠才上線（登入→建 Space→建頁→編輯→閱讀→搜尋→私有隔離→登出）。
- **N-04**：RAG 權限隔離自動化測試通過才開放 AI（私有／AI 停用／軟刪／封存內容絕不進入檢索）。

## 專案結構

```
src/
  app/            App Router（(app) 應用、(auth) 認證、admin 後台、api Route Handlers、design-system 沙盒）
  actions/        Server Actions（薄殼：驗 session → 驗權限 → 呼叫 src/lib）
  lib/
    authz/        權限唯一入口（can / getAccessiblePageIds、policy）
    auth/         密碼、session、OIDC
    content/      savePage 儲存管線（三欄同交易同步）
    pages/ spaces/ search/ comments/ mentions/ notifications  領域邏輯
    llm/ rag/     Provider 抽象層、chunker、檢索、RAG
    jobs/         pg-boss 任務（嵌入索引、匯入、cron、GC）
    storage/      StorageProvider（local → 未來 S3）
    admin/ audit/ metrics/ env.ts / logger.ts   後台、稽核、指標、設定、日誌
  worker.ts       背景 worker entrypoint（打包為 dist/worker.js）
db/               PostgreSQL image（pgroonga base + pgvector）與 init 擴充
drizzle/          版本化 migration（0000–0019）
messages/         i18n 訊息檔（zh-TW.json）
tests/            integration（testcontainers）、e2e（Playwright）
scripts/          seed-admin.mjs（引導管理員）、build-worker.mjs
proxy/ backup/    Caddy 反向代理、備份 sidecar
docs/             specs / architecture / design / plans / ops
```

## 架構鐵律（PR 退回條件）

1. 權限判斷只能在 `src/lib/authz/`；UI/Action/Route/RSC 一律呼叫 `can` 與 `getAccessiblePageIds`，權限預設拒絕。
2. RAG／語意檢索必須在 SQL 層 join 權限過濾，禁止先取回再過濾（N-04）。
3. 所有設定只能經 `src/lib/env.ts`（Zod fail-fast）。
4. UI 字串一律進 `messages/zh-TW.json`，零硬編碼（ESLint 強制）。
5. 內容三欄位只能在 `savePage` 同一交易內同步；任何其他寫入路徑（匯入、還原、回填）必須重用同一儲存管線。
6. Server Action／Route Handler 只做薄殼：驗 session → 驗權限 → 呼叫 `src/lib`。

## 文件索引

- 專案狀態與下一步：[`PROJECT_STATE.md`](PROJECT_STATE.md)
- 工作流與約束：[`CLAUDE.md`](CLAUDE.md)、[`constraints.md`](constraints.md)、[`definition-of-done.md`](definition-of-done.md)
- 架構決策：[`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md)
- 規格：[`docs/specs/`](docs/specs/)（功能需求、非功能需求）
- 架構：[`docs/architecture/`](docs/architecture/)（系統架構、A-10 中文分詞 spike）
- 設計：[`docs/design/`](docs/design/)（UI 規格、審查報告、HTML mockups）
- 規劃：[`docs/plans/`](docs/plans/)（issue 拆解、里程碑、依賴圖）
- 維運：[`docs/ops/backup-restore-runbook.md`](docs/ops/backup-restore-runbook.md)（備份與還原演練）
- 指南：[`docs/guides/mcp-server.md`](docs/guides/mcp-server.md)（MCP Server 接入）

## 部署與維運

- **HTTPS**：正式環境於 `proxy/Caddyfile` 掛公司內部網域與內部 CA／自簽憑證（全程 HTTPS）。
- **遷移**：`db:migrate` 為獨立部署步驟，於 web 起站前或起站後盡快執行。
- **備份**：backup sidecar 每小時 `pg_dump -Fc`（保留 48 份）＋每日晉升（保留 30 天）＋ uploads 鏡像；正式環境應將備份綁至異機儲存並定期執行還原演練。
- **指標**：`/api/metrics`（Prometheus）；設 `METRICS_TOKEN` 後抓取端需帶 Bearer。
- **相依服務**：`web` 以 `/api/readyz` 為 healthcheck，依賴 `db` healthy 後啟動。

## 尚未涵蓋（M4 backlog）

變更請求、行內評論、webhooks（暫停）、PDF 匯出、KaTeX、多欄版面、snippets、內容分析等，依實際使用回饋再拆解（追蹤於 issue #93）。

## 授權與原創聲明

JetBook 為凱銳光電內部專案。功能對標 GitBook，但所有程式碼與視覺資產均為原創，僅使用 MIT/Apache 等寬鬆授權之開源函式庫（如 TipTap、Radix UI、Drizzle、Next.js），未複製 GitBook 原始碼或設計資產。
