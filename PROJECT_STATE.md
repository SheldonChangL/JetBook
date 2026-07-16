# PROJECT_STATE.md — JetBook 專案狀態

> 每個 issue 完成、或狀態有變（blockers、範圍調整）時必須更新本檔。

## 專案

**JetBook** — 凱銳光電（Jet Opto）內部知識管理系統（類 GitBook）。
Next.js（App Router、TS strict）全端 + PostgreSQL 16/pgvector/pgroonga + Docker Compose；AI RAG 問答（前期 Claude API → 後期 Local LLM，經 Provider 抽象層以 env 切換）；繁體中文預設。

## 目前階段

**v1 商品化完成 ✅（2026-07-13）。** M0–M3 全部 91 個 issue 關閉並合併；目前開放 #93 M4 backlog 與 #249 UI Design v2 設計交付。

### 出貨閘門與終驗證據（全數實測通過）
- **N-02 MVP E2E 冒煙**：Playwright 全旅程（登入→建空間→建頁→編輯→閱讀→搜尋→私有隔離→登出），CI 綠（PR #151、#186 head run）
- **N-04 RAG 權限隔離**：自動化整合測試（私有/AI 停用/軟刪/封存內容絕不入檢索），CI 必跑（PR #172）
- **終驗鏈**：lint ✅ typecheck ✅ 單元 447/447 ✅ 整合 203/203（0 unhandled）✅ next build ✅ worker build ✅
- **production 起站**：`docker compose up -d --build` 五服務全起（proxy/web healthy/worker/db healthy/backup）；經 proxy 驗證 307→login、/login 200、healthz/readyz 200；worker started
- **備份實跑**：backup.sh 一次性執行成功（pg_dump 108KB + uploads 鏡像；hourly×48/daily×30 保留策略運作中）
- **CI**：Validate + E2E 雙 job 全綠（#186 修復 build-time env 後首次真綠）

### 部署摘要
`cp .env.example .env` 填實值 → `docker compose up -d --build`。AI 功能以 env 開關（LLM_PROVIDER=anthropic|openai-compat + EMBEDDING_BASE_URL 指向 local BGE-M3）；未設定時 AI 入口自動隱藏、其餘功能不受影響。SSO 以 AUTH_OIDC_* 啟用。

### M4 第一批（2026-07-13 依使用回饋拆解，#192–#199）
使用者需求 8 項評估後拆為 8 issues；決策：Redmine 匯入走 CSV 匯出、Word→MD 轉頁面優先、Webhooks（F-API-03）暫停。

- [x] #192 M4-01 使用者搜尋與篩選（搜尋/狀態/分頁，整合測試 6 條）
- [x] #193 M4-02 CSV 批次建立使用者（Redmine 欄名相容、預覽驗證、單交易批次、歡迎信走重設連結）
- [x] #194 M4-03 emoji 圖示選擇器（emoji-mart core、編輯器/Space 設定/建立 Modal、Cmd+K 全文結果補 icon；瀏覽器實測）
- [x] #195 M4-04 附件批次上傳與檔名搜尋（多檔選取/拖放、搜尋頁附件區塊、權限 SQL join）
- [x] #196 M4-05 Email 通知（notify 鏡射 → pg-boss job → SMTP；個人設定逐類開關，預設全開）
- [x] #197 M4-06 REST API v1 + API Token（api_tokens 表、Bearer 驗證、4 個唯讀端點、OpenAPI 文件頁、token 管理 UI；curl 實測）
- [x] #198 M4-07 MCP Server（/api/mcp streamable HTTP、Bearer token、3 工具；真 MCP client 實測搜尋→讀取）
- [x] #199 M4-08 Word (.docx) 匯入（mammoth+turndown → 既有 savePage 管線；圖片轉附件；瀏覽器 E2E 實測。附帶發現既有 Unicode slug 404 → #207）

### M4 第二批（2026-07-14 使用回饋，#211/#212）
- [x] #212 M4-10 API Token 建立後一鍵複製（copyText 通用化＋toast 回饋；瀏覽器實測）— PR #213
- [x] #211 M4-09 MCP/REST API 寫入能力：token write scope（建立時勾選，預設唯讀）、MCP `create_page`/`update_page`、REST POST /spaces/{slug}/pages 與 PATCH /pages/{id}；重用唯一儲存管線（三欄同交易＋版本快照＋embedding enqueue）、can() 預設拒絕、尊重編輯鎖、audit；整合測試 8 條＋真 MCP client 實測 create→read→update 往返與 scope 閘門 — PR #217（原 stacked PR #214 因 base 分支刪除改開）
- [x] #218 M4-13 MCP/REST 寫入第二批：`update_page` 部分更新（title 改名走 renamePage 規則：slug 重算＋301 歷史、title-only 不動版本；`expectedVersion` 樂觀鎖，衝突回目前版本號）＋`create_space`（MCP 工具與 REST POST /api/v1/spaces；createSpaceCore 抽至 lib/spaces/create.ts 供 web/API 共用，slug 自動產生、建立者成 space admin、audit `space.api_create`）；整合測試 +9 條（254 綠）＋真 MCP client 實測 create_space→create_page→改名→過期版本拒絕→正確版本寫入

### M4 第三批（2026-07-14 全數完成，#215/#216/#219/#220/#222）
- [x] #222 web 改名後重嵌 embedding（標題在 chunk 內；no-op 不 enqueue）— PR #223
- [x] #219 M4-14 move_page：同空間 reparent（movePageNode）／跨空間子樹搬移（movePageSubtreeToSpace，附件歸屬同交易轉移，掛目標根層）；雙端權限＋交易內重驗來源 space（TOCTOU）；MCP 工具＋REST POST /pages/{id}/move；CYCLE 409、INVALID_MOVE 400；整合測試 +9 — PR #226（既有缺口另開 #224 並發成環、#225 回收桶還原孤兒）
- [x] #220 M4-15 delete_page：softDeletePageSubtree 抽至 trash.ts（web 共用）；一律軟刪進回收桶、recursive:false 只刪單列（HAS_CHILDREN 409 含 childCount）；audit 沿用 page.delete＋via=api；MCP 工具帶破壞性警告；整合測試 +5 — PR #227
- [x] #215 M4-11 PDF 附件線上預覽：/api/files/[id]/preview（僅 PDF inline、nosniff、下載端點不動）；附件卡片＋搜尋結果預覽 Modal；整合測試 +4＋瀏覽器實測 — PR #228
- [x] #216 M4-12 Office 轉 PDF 預覽：Gotenberg sidecar（env-gated 優雅降級）＋attachment_previews 表（migration 0020）＋pg-boss 轉檔 job（lazy 補排、failed 冷卻自癒、衍生檔生命週期含 GC 連動）；前端轉換中輪詢；整合測試 +5＋Gotenberg 真實轉檔＋瀏覽器全循環實測 — PR #229

### M4 缺口修復（2026-07-14，#224/#225，M4-14 review 衍生；Opus 實作＋交叉 review）
- [x] #225 回收桶還原孤兒：`restoreTrashPage` reparent-to-root 條件補 `parent.spaceId !== page.spaceId`，跨空間搬移遺留的軟刪子孫還原後掛回來源空間根層（不成兩邊樹皆不可見的孤兒）；整合測試 +1（重現場景） — PR #231
- [x] #224 並發 reparent 成環：`movePageNode` 交易開頭以每空間 `pg_advisory_xact_lock` 序列化同空間全部 reparent（取鎖後重讀防 TOCTOU）；覆蓋兩節點互掛與多節點（不相交鎖集合）環——列鎖方案於 review 被反例駁回後改採；整合測試 +2（8 輪 flake 保險） — PR #232

### M4 後續修正（2026-07-15，使用回饋）
- [x] MCP 空間工具鏈補齊 spaceId：`list_spaces`（原本漏印，導致 `create_page`/`move_page` 拿不到目標空間 id 而斷鏈）、`search_pages`、`read_page` 皆回傳 spaceId，任一唯讀結果即可直接餵寫入工具，免再繞一次 list_spaces；`SearchHit` 於 SQL 層加 `s.id`（純新增欄位，web 搜尋與 REST `/api/v1/search` 不受影響）；MCP 整合測試補 spaceId 斷言＋真 MCP client 實測三工具皆含 spaceId — PR #235
- [x] #237 MCP 外部圖片匯入為永久附件＋修復圖片 Markdown 往返：根因＝`markdownToDoc` 對圖片一律降級為連結、API 寫入路徑（`apiCreatePage`/`apiUpdatePage`）未帶 `resolveImageSrc`，故連內部 `/api/files/<id>` 都降級。修復＝寫入路徑帶 `internalAttachmentImageResolver`（內部 URL→image 節點、`read_page` 完整往返、閱讀端內嵌；外部維持降級）；新增 MCP 工具 `import_attachment_from_url`（伺服器端下載→magic bytes 內容驗證→重用 `saveAttachment` 存永久附件並綁定頁面→回內部 URL＋Markdown）；SSRF 防護（`JETBOOK_ATTACHMENT_IMPORT_HOSTS` allowlist 預設拒絕、DNS/IP 逐跳重驗、封鎖 loopback/link-local/metadata/multicast、redirect 上限、size/timeout、連線 pin 至已驗證 IP、不記憑證）；ADR-012。測試＝unit +62（ssrf/sniff/downloadImage/resolver）、整合 +15（真 PG：往返/JPEG-PNG-WebP/bytes 一致/權限/allowlist/redirect 禁址/超大/型別不符/無孤兒/版本衝突/一般連結不誤判/list_spaces 仍回 spaceId）；並以七張真實 Redmine 圖片走完整正式路徑（真網路下載→SSRF→存 PG→往返）端到端驗收通過（size 與 Redmine 宣告逐一相符）。**線上匯入至 DA005 頁面待部署本分支＋設 env 後執行** — PR #238（已合併）
- [x] #239 附件儲存 volume 權限修正（部署 bug，阻擋 #237 線上匯入）：根因＝`UPLOAD_DIR` 預設相對路徑 `./data/uploads` 解為 `/app/data/uploads`（非 root 不可寫），與 compose 掛載點 `/data/uploads` 不一致→`EACCES mkdir '/app/data'`，且附件從未落在掛載 volume。修正＝compose web/worker 設 `UPLOAD_DIR=/data/uploads`、Dockerfile 於 `USER` 前 `mkdir -p /data/uploads && chown nextjs:nodejs`（fresh named volume 首掛即繼承 1001 owner）、`.env.example` 註記。驗證＝實建 image 確認 `/data/uploads` owner=1001，掛 fresh named volume 後以 UID1001 實跑 mkdir+writeFile 成功。既有部署須一次性重建空的 uploads volume（不動 pgdata/backups）。 — PR #240
- [x] 空間管理 API 完整化（MCP + REST 對等）：`create_space` 加 `visibility`（省略＝private，一次建出可共享空間）；新增 `update_space`（改 name／description／icon／visibility）與 `set_space_member`（以 email 加／改／移除成員角色，role=none 移除；不可移除最後一位 admin）；共用 lib 核心（`updateSpaceFields`／`setSpaceMemberRole`，web action 一併改用避免漂移）、權限一律 `can(space.manage)`、不存在/無權統一 NOT_FOUND_OR_FORBIDDEN 防枚舉；REST 新增 `PATCH /api/v1/spaces/{slug}`、`PUT /api/v1/spaces/{slug}/members` 並更新 OpenAPI；整合測試 +8（含 undefined 部分更新不清空、LAST_ADMIN 409、防枚舉 404）＋真 MCP client 實測三工具往返 — PR #235 之後（已合併）

### M4 後續修正（2026-07-16，使用回饋）
- [x] #243 M4-16 編輯器/附件 UX：內嵌文件可調整可視區＋空狀態 placeholder＋顯眼插入入口與圖片 slash — PR #244（已合併）
- [x] #245 修正 ```mermaid Markdown 圍籬未渲染（顯示為程式碼區塊）：根因＝`markdownToDoc` 對所有圍籬一律產 `codeBlock`，與 `serialize.ts`（mermaid 節點→```mermaid）不對稱，故 Markdown 入口（編輯器貼上、J-01/J-02 匯入、MCP/REST 寫入）的圖表都被存成 codeBlock(language=mermaid)。修正＝(1) 轉換器將 ```mermaid 圍籬轉為 `mermaid` 節點（canonical、對稱往返、涵蓋所有寫入路徑、語言不分大小寫）；(2) 閱讀端 fallback 對既有 `codeBlock`(language=mermaid) 也以圖表渲染，使既有頁面部署後免逐頁重存即正確顯示。單元測試 +5（圍籬→節點、大小寫、空圍籬、mermaidjs 不誤判、docToMarkdown↔markdownToDoc 往返）；lint/typecheck/test 519/build 全綠。in-browser 因本地驗證 db 密碼與現行 .env 不符（長跑容器）未於本機驅動，交部署後確認 — PR #246（已合併）
- [x] #247 閱讀端 Mermaid 圖表點擊放大檢視：新元件 `mermaid-zoom.tsx`（Radix Dialog lightbox，比照既有圖片 lightbox）——點圖開放大 Modal，開啟自動 fit 視窗、+/−/滾輪縮放、拖曳平移、%讀數。**縮放採「改 SVG 佈局寬度」而非 CSS transform:scale**（transform 放大的是已光柵化圖層＝糊；mermaid 用 foreignObject HTML 標籤，改佈局寬度會觸發整個 SVG 重繪＝銳利，`!important` 蓋過 mermaid 內嵌 max-width）；平移才用 translate；pan 容器 `flex:none`（否則 flex-shrink 壓回容器寬度無法放大）。`MermaidDiagram` 加 `zoomable`（閱讀端啟用、編輯端預設關閉行為不變）；深色 overlay＋`--bg-raised` 卡片兩色系皆可讀；零新增相依；i18n `reading.mermaid.*`。lint/typecheck/test 519/build 全綠。**放大清晰度已於隔離 harness（scratchpad，專案自帶 mermaid + 相同 config）瀏覽器實測**：確認 mermaid 輸出 foreignObject、寫法在 3x 下文字銳利、並藉此抓出 flex-shrink bug；React 串接於真 app 待部署後確認 — PR #248

### UI Design v2 探索（2026-07-16，#249）

- [x] 在 `feature/issue-249-ui-redesign-mockups` 交付兩套全新方向：Optic Grid／稜光格線與 Archive Studio／知識工坊；各含 Dashboard、閱讀、編輯、搜尋＋AI 的淺／深色版，共 16 張 1440×900 PNG
- [x] 新增可切換方案／畫面／主題的離線 HTML 索引、方案比較與完整功能覆蓋矩陣；深淺模式內容與狀態完全一致，瀏覽器驗證零 console error／warning，並支援 reduced-motion
- [x] 本階段僅新增 `docs/design/mockups-v2/`，未修改正式產品 `src/`；選定方向後才拆六個順序 issue／PR 實作
- [x] 使用者選定 **Archive Studio／知識工坊**；正式實作採 Legacy／Archive presentation layer 並存、全域 kill switch＋使用者 cookie 切換的漸進遷移策略，未完成覆蓋前不移除舊 UI

### 尚未完成（v1 之後）
- **UI Design v2**：Archive Studio 已選定；依六個順序 issue／PR 實作，第一批為 token、基礎元件、Legacy 回退機制、App/Admin Shell、登入與錯誤頁
- **#93 M4 backlog**：變更請求、行內評論、webhooks（暫停）、PDF 匯出、KaTeX、多欄、snippets、內容分析等——其餘候選項依回饋再拆
- 真實 LLM/Embedding 端點串接為部署設定（本機開發以 mock 驗證介面）；上線時以 /admin/ai 測試連線驗證


## GitHub 執行狀態

- Repo：https://github.com/SheldonChangL/JetBook（private）
- Issues：開放 #93（M4 backlog 彙總）與 #249（UI Design v2 mockup／選案）；M4 已交付 #192–#199、#207、#211/#212、#215/#216、#218/#219/#220、#222、#224/#225（task ID ↔ issue 對照見 docs/plans/issue-plan.md）
- Milestones：M0 10/10 ✅／M1 42/42 ✅／M2 16/16 ✅／M3 23/23 ✅／M4 已交付 15 功能＋多項修復（backlog 追蹤 #93）
- 工作流：branch `feature/issue-<n>-<slug>` → PR（Fixes #n）→ squash merge（使用者已授權 self-merge）；目前分支 `feature/issue-249-ui-redesign-mockups`，active issue #249，最新已合併 PR #248

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

### M1 MVP（42/42 ✅，含後期拆分掛入的細項 issue）

認證（本地帳號 Argon2id/DB session/防暴力破解/忘記密碼/OIDC 預留）、Space 與頁面樹（visibility 三態、
角色四級、拖曳搬移、slug/301）、TipTap 編輯器全套區塊（slash/程式碼/表格/callout/圖片/附件/Markdown 貼上）、
軟性編輯鎖＋樂觀鎖、版本快照/檢視/還原、pgroonga 中文全文搜尋、Cmd+K、App Shell/閱讀頁/Dashboard、
附件上傳下載（權限保護）、管理後台（使用者/系統健康）、testcontainers 整合測試基建、備份機制、E2E 閘門。

### M2 AI 核心（16/16 ✅）

LLM/Embedding Provider 抽象層（Anthropic ↔ OpenAI-compatible，env 切換）、pg-boss worker、chunker、
嵌入索引管線（增量 hash）、全庫重嵌、Hybrid 檢索（RRF，SQL 層權限過濾）、RAG 問答 SSE（引用+跳轉）、
AI 抽屜、語意搜尋、rate limit＋用量稽核、Markdown/Zip 匯入、N-04 隔離閘門。

### M3 協作治理（23/23 ✅）

留言、通知、@mention＋頁面連結、群組授權（主體泛化）、AI 配額、寫作輔助、AI/稽核後台、回收桶、
Space 封存/軟刪、跨 Space 移動複製、死鏈標示、附件 GC、Tabs/摺疊/Stepper、Mermaid、embed 白名單、
版本 diff（中文字級）、搜尋過濾器、Markdown 匯出、Collection、群組/外部連結節點、Prometheus metrics。

測試規模：單元 447、整合（真 PG＋pgroonga）203、Playwright E2E 冒煙全旅程。

## 關鍵已拍板決策（摘要，全文見 ADR）

- C1：軟性編輯鎖（心跳 30s、閒置 5 分釋放、Admin 可搶鎖）＋樂觀版本檢查備援
- C2：v1 直接編輯＋autosave＋自動版本快照，無草稿／發布閘門
- ORM＝Drizzle；佇列＝pg-boss；embedding day-1＝local BGE-M3（1024 維）
- **ADR-007 已定案：中文全文檢索＝pgroonga**（pages 不需 search_tsv 欄位，索引直接建在 text 欄位）
- 兩道閘門：N-02（MVP E2E 全綠才上線）、N-04（RAG 權限隔離測試通過才開放 AI）

## Blockers

無。

## 下一步

1. 合併 #249 設計 PR；建立 UI Design v2 第一批 issue，實作 Archive Studio token、Legacy 回退機制、Shell、登入與錯誤頁
2. 後續依六個順序 issue／PR 逐步遷移內容工作區、編輯器、搜尋／AI 與管理後台；每批以使用者切換與全域 kill switch 驗證可回退
3. 部署到公司內部伺服器：`.env` 填正式值（含 SMTP_*；要開 Office 預覽加 `PREVIEW_CONVERTER_URL=http://gotenberg:3000`）、`docker compose up -d --build`、跑 `db:migrate`（0020）
4. 串接真實 AI 端點（ANTHROPIC_API_KEY + local BGE-M3）；MCP 依 docs/guides/mcp-server.md 讓 Claude 接上知識庫（每人自建 API token；寫入需勾選 write scope）
5. 其餘 backlog 候選見 #93（變更請求、行內評論、webhooks、PDF 匯出、KaTeX 等，依回饋再拆）
6. 未拆 issue 的殘餘觀察（#232 review 記錄）：跨空間子樹搬移與同空間 reparent 交錯可能產生「parent 在他空間」的懸掛連結（非環、屬 #225 家族），需要時再開 issue
