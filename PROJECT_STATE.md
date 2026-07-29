# PROJECT_STATE.md — JetBook 專案狀態

> 每個 issue 完成、或狀態有變（blockers、範圍調整）時必須更新本檔。

## 專案

**JetBook** — 凱銳光電（Jet Opto）內部知識管理系統（類 GitBook）。
Next.js（App Router、TS strict）全端 + PostgreSQL 16/pgvector/pgroonga + Docker Compose；AI RAG 問答（前期 Claude API → 後期 Local LLM，經 Provider 抽象層以 env 切換）；繁體中文預設。

## 目前階段

**v1 商品化完成 ✅（2026-07-13）。** M0–M3 全部 91 個 issue 關閉並合併；Archive Studio UI v2 六批亦已完成驗證。後續產品候選集中於 #93 M4 backlog。

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
- [x] PR #250 已合併、#249 已關閉；正式規格移至 `docs/design/ui-design-v2.md`

### UI Design v2 第一批（2026-07-16，#251）

- [x] 建立 `UI_V2_ROLLOUT=off|opt-in|on` 與 HttpOnly `legacy|archive` 偏好：`off` 強制 Legacy、`opt-in` 預設 Legacy、`on` 預設 Archive；非 `off` 均可雙向切換
- [x] Archive light／dark 語意 token 與原創 SVG `ArchiveMark`；Legacy token 保持原值，未新增字型、動畫或 UI 相依
- [x] App Shell（Command Rail＋Space Dock＋Canvas）、Admin Shell、登入／忘記密碼／重設密碼 Auth Frame，以及 403／404／error／offline presentation；既有路由、action、REST、MCP、SSE、schema 與 authz 未變
- [x] Production build 真實瀏覽器驗證：320／768／1024／1440 無水平溢位、light／dark、Archive ⇄ Legacy、`off` cookie override、`opt-in`、Cmd+K、Drawer focus trap／restore、reduced-motion；除刻意載入 404 文件本身的預期 404 response 外，console warning/error 與失敗網路請求皆為零
- [x] Browser QA 發現並修正 App／Admin 行動 Drawer 關閉後焦點未返回 trigger，以及 App Drawer 換頁後未關閉；`IconButton` 支援 ref forwarding，Playwright 同情境回歸通過
- [x] 品質閘門：lint ✅ typecheck ✅ 單元 526/526 ✅ 整合 304/304（含 N-04）✅ N-02 Playwright 2/2 ✅ production build ✅
- [x] PR #252 CI 全綠並已 squash merge；`UI_V2_ROLLOUT=off` 全域回退與非 off 使用者 Legacy ⇄ Archive 切換保留

### UI Design v2 第二批（2026-07-17，#253／PR #254）

- [x] Archive Dashboard、Spaces／Collections、Space overview／page tree、回收桶與 Space settings presentation
- [x] Legacy DOM／功能與 #251 rollout 回退路徑保持可用；URL、action、REST、MCP、SSE、schema、authz 不變
- [x] Production browser QA：Archive light／dark、320／768／1024／1440 五個代表路由零水平溢位；單一 task Dock、`Cmd/Ctrl+\\` 臨時展開、設定行動橫向索引、建立 Modal Esc＋focus restore、Legacy 回切均通過；console warning/error 為零
- [x] 本機品質閘門：lint ✅ typecheck ✅ 單元 530/530 ✅ 整合 304/304（含 N-04）✅ N-02 Playwright 2/2（Archive rollout）✅ production build ✅
- [x] PR #254 的 Validate（含 N-04）與 N-02 全綠並已 squash merge

### UI Design v2 第三批（2026-07-17，#255／PR #256）

- [x] Archive 閱讀工作區、H2／H3 TOC scroll-spy、內容 renderer、留言 Inspector、版本歷史／差異／還原、附件與 PDF／Office 預覽 presentation
- [x] Legacy 與 rollout 回退、既有路由／action／權限／資料規則保持不變；無 schema、REST、MCP、SSE 或 authz 變更
- [x] Production browser QA：Reader light／dark、TOC 錨點、留言新增／刪除、版本任兩版比較、還原 Modal Esc＋focus restore、Archive ⇄ Legacy；Playwright 320／768／1024／1440 light／dark 零水平溢位、零 console warning/error 與非預期 request failure；viewer／commenter／editor／admin 實際角色驗證確認編輯入口、留言輸入與他人留言刪除權限正確
- [x] 本機品質閘門：lint ✅ typecheck ✅ 單元 532/532 ✅ 整合 304/304（含 N-04 與 Office preview 狀態）✅ N-02 Playwright 2/2（Archive rollout）✅ production build ✅
- [x] PR #256 的 Validate（含 N-04）與 N-02 全綠並已 squash merge

### UI Design v2 第四批（2026-07-17，#257／PR #258）

- [x] Archive 編輯器 Canvas／Inspector、autosave、鎖定／搶鎖／失鎖、版本衝突、既有完整區塊工具、AI 寫作與 import/export presentation；功能覆蓋矩陣同步校正為實際產品能力
- [x] Legacy 與 rollout 回退保持可用；既有 URL、Server Action、REST、MCP、SSE、schema、authz、儲存與衝突規則不變
- [x] 瀏覽器功能 QA：繁中 IME、autosave、Slash／表格、閱讀回寫、import/export 入口、AI SSE 產生→確認套用；editor／admin／viewer 權限、Admin 搶鎖、原編輯者 30 秒心跳後轉唯讀，以及獨立 DB version bump 觸發 `VERSION_CONFLICT` 並保留本機文字均通過
- [x] Production browser QA：320／768／1024／1440、light／dark、Archive ⇄ Legacy 內容不變、零水平溢位與零 console warning/error；QA 抓出並修正空行「＋」浮動插入控制在 320px 超出 viewport
- [x] 本機品質閘門：lint ✅ typecheck ✅ 單元 532/532 ✅ 整合 304/304（含 N-04）✅ N-02 Playwright 2/2（Archive rollout）✅ production build ✅
- [x] PR #258 的 Validate（含 N-04）與 N-02 全綠並已 squash merge

### UI Design v2 第五批（2026-07-17，#259／PR #260）

- [x] Archive 搜尋、Cmd+K、AI Drawer／歷史／引用、通知、個人設定、API Token 與 API Docs presentation；功能覆蓋矩陣同步校正 `/search` 全文／附件與 Cmd+K 語意搜尋的實際邊界
- [x] Legacy 與 rollout 回退保持可用；既有路由、Server Action、REST、MCP、SSE、schema、authz、全文／語意搜尋、AI governance 與 Token 規則不變
- [x] Browser QA：320／768／1024／1440、light／dark、搜尋／設定／API Docs 零水平溢位與零 console warning/error；Cmd+K 全文／語意／AI、繁中 IME、AI SSE／引用／歷史、通知空狀態、Token Modal、Archive ⇄ Legacy 查詢狀態保留均通過。QA 抓出並修正 Cmd+K 關閉焦點未復原及 Token Modal 未聚焦名稱欄
- [x] 本機品質閘門：lint ✅ typecheck ✅ 單元 532/532 ✅ 整合 304/304（含 N-04）✅ N-02 Playwright 2/2（Archive rollout）✅ production build ✅ production bundle browser smoke ✅
- [x] PR #260 的 Validate（含 N-04，3m51s）與 N-02（3m04s）全綠並已 squash merge

### UI Design v2 第六批（2026-07-17，#261／PR #262）

- [x] Archive 管理後台：使用者／CSV、群組／成員批次匯入、已刪除 Space、AI、稽核與系統 presentation；既有 action、authz、schema、REST／MCP／SSE 與資料規則不變
- [x] 全站 responsive／keyboard／focus／IME／reduced-motion／深淺色與 Legacy 回退收尾；手動開啟的管理 Modal 改由 Radix Trigger 記錄並復原焦點，320px 寬表補可聚焦、具名稱的方向鍵捲動區域
- [x] 功能覆蓋矩陣與 Browser QA：6 路由 × 320／768／1024／1440 × light／dark 共 48 組零文件溢位、零 page console warning／error；drawer／Modal focus、CSV preview、群組 CRUD／匯入、audit query、Archive ⇄ Legacy、reduced-motion 皆通過；production bundle 320／1440 light／dark smoke 通過
- [x] 本機品質閘門：lint ✅ typecheck ✅ 單元 532/532 ✅ 整合 304/304（含 N-04）✅ N-02 Playwright 2/2（Archive rollout）✅ production build ✅
- [x] PR #262 的 Validate（含 N-04，3m45s）與 N-02（3m29s）全綠；符合既有 self-merge 授權

### UI Design v2 編輯體驗迭代（2026-07-17，#263／PR #264）

- [x] Archive 編輯路由改為寫作優先 focus mode：收起 Space 頁面樹與常駐 Inspector，改以置中的文件紙張 Canvas、精簡頂列及按需展開的文件狀態 Popover；Legacy fallback、路由、儲存、鎖定、衝突與權限邏輯均不變
- [x] 新增桌面快捷插入列（區塊／圖片／附件／表格）、行動版固定底部工具列，以及選取文字時的 TipTap BubbleMenu（粗體／斜體／刪除線／行內程式碼）；完整 Slash menu、進階區塊與 AI 寫作工作層保持可用
- [x] Production browser QA：320／768／1024／1440、light／dark、Archive ⇄ Legacy、繁中輸入、autosave、檔案選擇、Slash／表格、Popover Esc＋focus restore、reduced-motion 與格式狀態均通過，零水平溢位與零 console warning/error
- [x] QA 抓出並修正 320px 頁面樹占用寫作空間、格式按鈕 `aria-pressed` 未即時同步，以及重複 autosave live region 造成 Playwright strict locator 失敗
- [x] 本機品質閘門：lint ✅ typecheck ✅ 單元 532/532 ✅ 整合 304/304（含 N-04）✅ N-02 Playwright 2/2（Archive rollout）✅ production build ✅

### UI Design v2 編輯器回歸修正（2026-07-17，#265／PR #266）

- [x] 修正 #264 後 Archive 編輯頂列同時顯示 Legacy secondary 與 Archive primary 兩個「完成編輯」按鈕；根因為共用 button selector 的 `display` specificity 蓋過 `.ui-legacy-only` 隱藏規則
- [x] `PageEditor` 改為只渲染一個完成動作，Legacy 沿用 secondary variant，Archive 以 scoped semantic token 覆寫成 primary presentation；點擊與返回閱讀流程不變
- [x] N-02 明確以 Archive rollout 啟動，並斷言 Archive 編輯頁與 accessibility tree 只有一個精確命名的完成按鈕；回歸測試先穩定得到 2、修正後完整旅程轉綠
- [x] Production browser QA：Archive light／dark × 320／768／1440 與 Legacy light／dark 共 8 組均只有一個完成按鈕、零水平溢位、零 console warning／error；兩套 presentation 各自外觀保持正確
- [x] 本機品質閘門：lint ✅ typecheck ✅ 單元 532/532 ✅ 整合 304/304（含 N-04）✅ N-02 Playwright 2/2（Archive rollout）✅ production build ✅

### Build 版本識別（2026-07-17，#267）

- [x] GUI 常駐顯示當前部署版本（`version`＋git commit 短碼＋build 時間），讓反覆部署時一眼分辨是否生效、與上版差異。此為全新「app/build 版本識別」，非既有頁面內容版本歷史/diff
- [x] build 階段注入（ADR-013）：`env.ts` 加 `APP_VERSION`/`GIT_COMMIT`/`BUILD_TIME`（optional）；Dockerfile runner `ARG`→`ENV`；docker-compose web/worker `build.args`；CI `build-push-action` `build-args` 帶 `github.sha`＋`date -u`＋package.json version。runtime 無 git 依賴
- [x] `src/lib/build-info.ts`（純解析，client/測試共用）＋ `build-info-server.ts`（server-only，`getBuildInfo()`，package.json fallback、commit=dev）；顯示於共用 `BuildBadge`（Legacy／Archive 兩套 shell＋admin topbar，不隨側欄收合）、`UserMenu` 底部、admin 系統頁版本卡、`/api/healthz` JSON
- [x] 驗證：lint ✅ typecheck ✅ 單元 539/539（新增 build-info 7 條，含注入端到端 mock env→getBuildInfo）✅ next build ✅ worker build ✅；dev runtime `curl /api/healthz` 回 `{status,version,commit}`（fallback 值）✅、對照組舊 image 僅回 `{status:"ok"}`；登入頁 dev server 零 console error。**GUI badge 登入後畫面因安全規則不代輸密碼登入，交使用者/部署確認**
- [x] branch `feature/issue-267-build-version-badge` — PR #268（Fixes #267）

### UI Design v2 App Shell 側欄回饋修正（2026-07-17，#269／PR #270）

- [x] 回應使用者截圖回饋「左側兩條 bar 滿奇怪」：Archive App Shell 展開狀態由深色 Command Rail＋淺色 Space Dock 兩個相鄰 sidebar，改為 288px 單一 Archive Sidebar；品牌、首頁、所有空間、搜尋、個人設定與 Space Dock 共用同一 surface
- [x] 收合狀態保留 72px compact rail，`Cmd/Ctrl+\`、收合按鈕、行動版 Drawer、Legacy fallback、既有 route/action/authz/data flow 均不變
- [x] 測試與 QA：`getArchiveSidebarPresentation` 單元 guard；N-02 smoke 新增 Archive desktop 只有一個 visible aside 且含 `SPACE DOCK` 的回歸斷言；production browser QA 覆蓋 320／768／1024／1440 × light／dark，確認 1024/1440 展開只有一個 288px sidebar、收合只有一個 72px rail、320/768 無 desktop aside、零水平溢位與零 console warning/error
- [x] 驗證：lint ✅ typecheck ✅ 單元 541/541 ✅ 整合 304/304（含 N-04）✅ production N-02 smoke ✅ production build ✅ worker build ✅
- [x] 文件同步：`docs/design/ui-design-v2.md` 與 `docs/design/mockups-v2/feature-coverage.md` 改為展開單一 sidebar／收合 compact rail 模型

### 移除 Legacy UI，Archive 成為唯一 UI（2026-07-20，#271）

- [x] Phase A（前置 commit）：layouts/pages/auth 恆渲染 Archive、刪 Legacy 分支與 `app-shell.tsx`、解除 uiVersion prop/型別穿線、移除 UI 切換按鈕與孤兒 i18n 鍵
- [x] Phase B（前置 commit）：刪 rollout 機制（`ui-version*`、`setUiVersionAction`）與 `UI_V2_ROLLOUT` env、`.env.example`／playwright 對應設定
- [x] Phase C：25 個 page/component 移除 `ui-archive-only` marker，元素恆顯示
- [x] Phase D：`globals.css` unscope — Archive token 併入 `:root`／`html.dark`（`--code-*` 保留原值）、562 選擇器去 `html[data-ui-version="archive"]` 前綴、刪 toggle 規則、compound selector 改寫；`layout.tsx` 移除 `data-ui-version` 屬性；`smoke.spec` 移除對應斷言；`page-editor` 收斂雙 UI 殘留的相同儲存狀態分支
- [x] 視覺不變性：移除前後 production dev server 對 11 路由 × light/dark 全頁截圖逐像素比對；read/search/settings/spaces/trash/notfound 零差異，login/dashboard/admin/edit 的差異經與「同版本重截」對照組確認全為動態內容/游標噪音，非樣式回歸
- [x] 殘留 grep（`ui-version`／`data-ui-version`／`ui-archive-only`／`ui-legacy-only`／`UI_V2_ROLLOUT`）於 `src`／`tests`／`scripts`／`.env.example` 皆為空
- [x] 品質閘門：lint ✅ typecheck ✅ 單元 534/534 ✅ 整合 304/304（含 N-04）✅ N-02 Playwright 2/2 ✅ next build ✅ worker build ✅
- [x] 文件同步：`docs/design/ui-design-v2.md` §3 改記 rollout 已完成並移除、§4 token 改為全站直接定義；`feature-coverage.md` 更新；新增 ADR-014
- [x] 取捨：放棄 env-based 即時回退舊 UI 的 kill switch（已確認接受），緊急回退改為部署上一版 image

### 內部環境首次上線＋登入重導向迴圈修復（2026-07-27，#273／PR #274）

- [x] 首次部署至公司內部 Ubuntu VM（Compose 六服務：proxy／web／worker／db／gotenberg／backup 全起，web healthy）。主機 80／5432 已被既有服務佔用，故以 `.env` 的 `HTTP_PORT`／`POSTGRES_PORT` 改綁非特權埠避開，不需 sudo、不影響既有服務；migration 與 `seed-admin` 以一次性 `node:22-alpine` 容器執行（VM 主機 node 版本低於 `engines: >=22`），以 uid 1000 執行避免產生 root-owned 檔案
- [x] 部署實測：21 個 migration 全數套用、`/api/healthz` 版本戳記與 commit 相符、`/api/readyz` ready、worker started、backup sidecar 首次備份成功（daily dump＋uploads 鏡像）、靜態資源經 proxy 200、i18n 繁中正常；六服務閒置實測共約 265 MB
- [x] #273 密碼變更後 `/login` 無限重導向（`ERR_TOO_MANY_REDIRECTS`）：根因＝密碼變更撤銷該使用者全部 session（正確的安全行為），但 `middleware` 在 edge 無 DB、只能判斷 cookie 是否存在就把 `/login` 轉回 `/`，與 `requireSession` 的 `redirect("/login")` 互推成迴圈。`resetPassword` 早已用 `deleteSessionCookie()` 迴避，但清 cookie 只能清操作者當下那台裝置——admin 重設**他人**密碼時對方瀏覽器必然殘留無效 cookie，伺服器端無從清除，故只補清 cookie 治不了根
- [x] 修正＝`middleware` 移除對 `/login` 的 cookie 快篩；「已登入者導回首頁」改由 `/login` 的 RSC 以 `getCurrentSession()` 真實驗證
- [x] 併同修復「admin 重設自己密碼後拿不到一次性密碼」（既有問題，修復迴圈前表現為迴圈、之後表現為按下按鈕沒反應）：`resetUserPassword` 撤銷本人全部 session 後，同一請求內的 `revalidatePath("/admin/users")` 要重新渲染需 org admin session 的頁面，無有效 session 即被導向登入，action 回傳的一次性密碼送不到 UI。修正＝重設對象是自己時為當前裝置重建 session 並換新 cookie（同 `changePasswordAction` 的處理原則），操作者維持登入、其他裝置維持失效
- [x] 驗證：lint ✅ typecheck ✅ 單元 544/544（新增 `src/middleware.test.ts` 10 條）✅ next build ✅；部署環境前後對照實測——修復前轉址鏈 `/` ⇄ `/login` 追到第 8 跳放棄，修復後 1 次轉址停在 `/login` 200 且登入表單可見，未帶 cookie 的內頁快篩（`307 → /login?returnTo=…`）不受影響
- [ ] 未驗證項（皆需真實登入 session，未代為登入驗證）：有效 session 訪問 `/login` 仍導回 `/`；admin 重設自己密碼後一次性密碼顯示且維持登入。`npm run test:integration` 未跑（本機 Docker 未啟動，本次 diff 未觸及 `src/lib` 層）
- [x] **測試缺口 #275**：`src/actions/` 層零測試覆蓋（無單元、整合測試只測 `src/lib`、e2e 未觸及 `/admin/users` 重設密碼流程），本 issue 兩輪 action 層回歸皆靠人工操作發現 → 已於 #275 補上 e2e（見下節），並回頭實測補齊上一項「未驗證項」中 admin 重設自己密碼的兩條斷言

### admin 重設密碼 e2e 覆蓋（2026-07-27，#275）

- [x] 新增 `tests/e2e/admin-reset-password.spec.ts` 2 條，咬住 #273 修的兩個結構性行為：**重設自己密碼**（一次性密碼確實顯示、操作者維持登入含硬重載、舊密碼失效、新密碼可登入）、**重設他人密碼**（對方 session 立即失效、帶殘留 cookie 訪問內頁單次轉址停在 `/login` 且轉址跳數 ≤2、對方可用一次性密碼自行登入）
- [x] 測試基建：`tests/e2e/accounts.ts` 新增專用帳號 `E2E_RESET_ADMIN`（org admin，自我重設用）與 `E2E_RESET_TARGET`（member，被重設對象）——兩者密碼都會被打斷，共用 `E2E_ADMIN`／`E2E_MEMBER` 會讓同批其他 spec 登入失敗；種子邏輯抽至 `tests/e2e/seed.ts`（`seedAccounts`／`seedAccount`），global-setup 與 spec 共用，spec 於每條測試開頭重置密碼與 `login_throttle`，對執行順序與 CI retry 免疫
- [x] 踩到並解掉的環境限制：登入 rate limit 是 **IP 層 5 次/分**（`src/lib/rate-limit.ts`），本 spec 需多次登入，共用同一 IP 桶會偽陽性失敗（POST /login 12ms 直接回 rateLimited）→ 每個角色一個 context 並帶各自 `x-forwarded-for`（dev server 前無 proxy；正式部署由 proxy 覆寫該 header，production 行為不變）
- [x] 反向驗證（issue 驗收要求）：拿掉 `resetUserPasswordAction` 的 session 重建 → 第 1 條紅在「新密碼已產生」永不出現（＝#273 原始症狀「按了沒反應」），第 2 條維持綠；把 `middleware` 對 `/login` 的 cookie 快篩加回去 → 第 2 條紅在 `net::ERR_TOO_MANY_REDIRECTS`（＝部署現場症狀），兩條測試各自咬住對應回歸
- [x] 品質閘門：lint ✅ typecheck ✅ 單元 544/544 ✅ next build ✅ Playwright 4/4（含 N-02 冒煙、Unicode slug）✅
- [x] 本次僅新增／調整 `tests/e2e/`，未動 `src/`（產品行為零變更）

### 個人設定頁：空白捲動區＋純 HTTP 複製 Token 無效（2026-07-27，#276）

- [x] 症狀 1「往下滑一片空白」根因＝`.archive-canvas`（唯一捲動容器）不是 positioned element，頁面內容裡 Tailwind `sr-only`（`position: absolute` 無 `top`）以**初始 containing block** 定位、逃過 overflow 裁切，把 `<html>` 的 scrollHeight 撐大成 document 層捲動。修正＝`.archive-canvas` 補 `position: relative`（單點修全站，`/settings` 1176→900、`/s/<slug>/settings` 1696→900）
- [x] 症狀 2「複製 Token 無效卻顯示成功」根因＝非安全內容（HTTP）無 `navigator.clipboard`，`copyText` 的 `execCommand` 後備把 textarea 掛在 `document.body`＝Radix Dialog focus trap 外，`focus()` 立刻被搶回，選取失效但 `execCommand` 照樣回傳 `true`。修正＝後備 textarea 掛進 focus trap 容器（`[role="dialog"]`／`[role="alertdialog"]`／`[role="menu"]`，否則退回 body）、複製後把焦點還給原元素，並改為「焦點確實落在 textarea」才算成功，否則回報失敗讓 UI 提示手動複製
- [x] 驗證（本機 dev server + 真 Chromium，經 LAN IP 走非安全內容以複現 HTTP 環境）：修復前 `execCommand` 時 `activeElement=BUTTON`、系統剪貼簿維持哨兵值；修復後 `activeElement=TEXTAREA`、從另一安全來源頁面讀回剪貼簿＝token 明文。11 路由逐一比對 `documentElement.scrollHeight` 與 canvas 內絕對定位元素座標，除兩個設定頁修好外其餘零位移
- [x] 回歸測試：新增 `tests/e2e/settings-layout-clipboard.spec.ts` 2 條（document 層無多餘捲動；移除 `navigator.clipboard` 模擬非安全內容後，從同 context 另一頁面讀回系統剪貼簿驗證真的寫入）。已驗證「還原修復即 2 條全紅、套回即全綠」
- [x] 品質閘門：lint ✅ typecheck ✅ 單元 544/544 ✅ next build ✅ Playwright 4/4（含 N-02 冒煙）✅
- [ ] 待辦（同類缺陷，未在本 issue 範圍）：`page-actions-menu.tsx`（複製 Markdown）、`code-block-reader.tsx`（複製程式碼）、`admin/users/user-row-actions.tsx` 仍直接呼叫 `navigator.clipboard.writeText`，在純 HTTP 環境同樣失效（前者靜默失敗），應改走 `copyText`

### Email 改走 Microsoft Graph（2026-07-28，#280／ADR-015）

- [x] 根因確認（部署主機實測）：對外防火牆**封鎖全部 SMTP 埠**（25／465／587），且為 port 層級全域封鎖——`smtp.gmail.com:587` 同樣不通，故非針對微軟；HTTPS 443 暢通，`graph.microsoft.com` 與 `login.microsoftonline.com` 皆回 200。原 SMTP 實作在部署環境永遠寄不出信，所有信件功能實質失效
- [x] 一併否決的替代方案：開通出口 587（需網管放行，且 M365 SMTP AUTH 預設停用／Basic Auth 淘汰的第二關未解）、Exchange direct send（同走 port 25，一併被封）
- [x] 實作：`src/lib/email` 單檔改目錄（`index.ts` provider 決定／`graph.ts`／`smtp.ts`／`types.ts`），Graph 走 client credentials + `POST /v1.0/users/{sender}/sendMail`；token 行程內快取（扣 60s 安全邊界）、併發 in-flight 去重、401 強制換新只重試一次。三處呼叫端（`actions/password-reset.ts`、`actions/admin.ts`、`worker.ts`）零修改
- [x] 設定：新增 `MAIL_PROVIDER`＋`GRAPH_*`；未指定 provider 時設了 `SMTP_HOST` 走 smtp（既有行為不變），皆未設定維持 logger fallback；**兩套都設定卻未指定 `MAIL_PROVIDER` 於 env 載入期 fail-fast**。`.gitignore` 改為忽略所有 `.env.*`（僅放行 `.env.example`）
- [x] 端到端實測（部署主機）：token 取得成功、JWT `roles` 含 `Mail.Send`、`sendMail` 回 HTTP 202，收件人確認實際收到信
- [x] 品質閘門：lint ✅ typecheck ✅ 單元 563/563 ✅ next build ✅ build:worker ✅
- [ ] **部署前置（IT 作業，非本 issue 交付物）**：目前測試借用的是帶有 `Mail.Read`／`Files.Read.All`／`Sites.Read.All` 的既有 app registration，**不得用於生產**。須另建僅授予 `Mail.Send` 的專用 app，並以 Application Access Policy 限縮至單一寄件信箱

### 站內使用說明與 MCP 自助接入（2026-07-28，#282／PR #283）

- 動機：使用者反映「MCP 設定教學」不易理解，且新使用者不知道 JetBook 怎麼用——原本教學只存在 repo 內的 `docs/guides/mcp-server.md`，站內完全沒有入口
- [x] 新增站內 `/guide`「使用說明」頁（RSC）：三分鐘上手（搜尋／閱讀／撰寫／權限／回收桶）＋ MCP 接入三步（建 token → 貼設定 → 驗證）＋工具能力與一人一把 token 安全說明
- [x] `src/components/mcp/mcp-setup.tsx`（唯一設定產生器）：以 `env.BASE_URL` 組出 Claude Code 指令與 Claude Desktop JSON，純 HTTP 部署自動補 `--allow-http`；沿用 `copyText`＋點擊全選後備
- [x] 建立 API Token 完成畫面直接嵌入該設定（明文 token 僅此刻存在＝唯一能給「複製即可用」設定的時機），並標示唯讀 token 的能力範圍
- [x] 入口：Dashboard 首次使用（無瀏覽紀錄）顯示上手三步卡＋兩個 CTA、命令列與頭像選單新增「使用說明」、API Token 區塊新增「如何接給 AI 助理」
- [x] 順帶修復 `ui/modal.tsx`：Modal 無 max-height，內容高於視窗時頂部與底部按鈕被裁掉無法操作（本次加長 token 建立 modal 後暴露）→ 改為 `max-h-[calc(100vh-32px)] overflow-y-auto`
- [x] `docs/guides/mcp-server.md` 全面重寫為任務導向（原本 11 個工具擠在單一 bullet）；README MCP 段落同步（原稱「三工具」已與實作不符）
- [x] 驗證：lint ✅ typecheck ✅ 單元 563/563 ✅ next build ✅；瀏覽器實測 `/guide`、Dashboard 引導卡、建立 token→設定片段（`--allow-http` 自動補上）、modal 內部捲動、深色模式＋375px 無橫向溢出、點擊全選後備（選取 118 字元）。剪貼簿 API 複製在內嵌瀏覽器無 user activation 無法驗證（機制沿用既有 `copyText`，#276 已處理純 HTTP 後備）

### MCP 接入跨平台修正（2026-07-28，#284）

- 回饋來源：使用者在 Windows 依站內 `/guide#mcp` 的設定接 MCP，Claude Desktop log 為 `'C:\Program' 不是內部或外部命令` 後 `Server transport closed unexpectedly`，連線從未建立
- [x] 根因＝我們發出的設定是 `"command": "npx"`。Claude Desktop 於 Windows 把 command 解析成絕對路徑後包進 `cmd.exe /c` 且**不加引號**，node 預設裝在 `C:\Program Files\nodejs`，cmd 只吃到 `C:\Program` 即失敗。與 token／權限無關，且**站內主要接入路徑在 Windows 上本來就不可用**
- [x] 修正＝設定產生邏輯抽為純函式 `src/lib/mcp/setup-snippets.ts`（`buildMcpSnippets`），Claude Desktop 分 macOS（`npx`）與 Windows（`cmd` + `/c` + `npx`，讓 cmd 自己走 PATH、args 各元素獨立傳遞不受空白影響）兩份；`McpSetup` 改為消費該函式，`/guide` 與建立 token 完成畫面同步受益
- [x] 站內 `/guide#mcp` 新增「接不上時怎麼查」七條：Windows 路徑引號（含 8.3 短路徑後備）、macOS GUI app 不繼承 shell PATH 的 `spawn npx ENOENT`、Linux 無官方 Claude Desktop 走 Claude Code、`--allow-http`、401／write scope、兩平台 log 檔位置、終端機手動跑一次的通用診斷
- [x] `docs/guides/mcp-server.md`：步驟 2 改為「先挑路徑」對照表 ＋ A Claude Code／B 內建連接器（僅 HTTPS）／C macOS／D Windows 四份設定；疑難排解拆為 6.1 啟動失敗（分平台、對照 log 症狀）與 6.2 連上了但被拒。README MCP 段落同步
- [x] 測試：單元 +8（`setup-snippets.test.ts`：Windows 必經 cmd /c、兩平台參數僅差前綴、純 HTTP 兩平台都補 `--allow-http`、HTTPS 不補、token 代入、Claude Code 不經 mcp-remote）；e2e +1（`guide-mcp-setup.spec.ts`：頁面實際送出兩份設定、Windows 那份不得是 `npx`、三平台排錯條目、i18n 缺鍵防呆）。**反向驗證**：把 Windows 設定改回 `npx` → 對應 2 條單元測試轉紅，改回即綠
- [x] 踩到並修掉的測試基建問題：新增登入吃掉 IP 層 rate limit（5 次/分）額度，害後續 `unicode-slug` 被 429 擋下 → 本 spec 比照 #275 帶獨立 `x-forwarded-for`
- [x] 品質閘門：lint ✅ typecheck ✅ 單元 571/571 ✅ next build ✅ Playwright 7/7（含 N-02 冒煙）✅；瀏覽器實測 `/guide#mcp` 1440 light／dark 與 375px，三份片段與排錯卡完整渲染、`--allow-http` 自動補上、`documentElement` 零橫向溢位、零 console error
- [x] 未跑：`npm run test:integration`（本次 diff 未觸及 `src/lib` 的 DB 或權限路徑，新增模組為純字串產生）

### 尚未完成（v1 之後）
- **UI Design v2 已完成**：#251／PR #252、#253／PR #254、#255／PR #256、#257／PR #258、#259／PR #260、#261／PR #262 六批與 #263／PR #264 編輯體驗迭代皆完成；#271 移除 Legacy fallback 後 Archive 為唯一 UI
- **#93 M4 backlog**：變更請求、行內評論、webhooks（暫停）、PDF 匯出、KaTeX、多欄、snippets、內容分析等——其餘候選項依回饋再拆
- 真實 LLM/Embedding 端點串接為部署設定（本機開發以 mock 驗證介面）；上線時以 /admin/ai 測試連線驗證


## GitHub 執行狀態

- Repo：https://github.com/SheldonChangL/JetBook（private）
- Issues：#93 追蹤 M4 backlog；Archive Studio UI v2 由 #251／PR #252、#253／PR #254、#255／PR #256、#257／PR #258、#259／PR #260、#261／PR #262 六批交付，#263／PR #264 交付編輯體驗迭代；#265／PR #266 修正重複完成按鈕回歸；#269 修正 App Shell 雙側欄視覺
- Milestones：M0 10/10 ✅／M1 42/42 ✅／M2 16/16 ✅／M3 23/23 ✅／M4 已交付 15 功能＋多項修復（backlog 追蹤 #93）
- 工作流：branch `feature/issue-<n>-<slug>` → PR（Fixes #n）→ squash merge（使用者已授權 self-merge）；#280 Graph 寄信與 #282 站內使用說明已合併進 main，目前分支 `feature/issue-284-mcp-cross-platform-setup`（#284 MCP 接入跨平台修正）
- 分支整理（2026-07-28）：本地累積 44 個分支，逐一以 PR 狀態核對後確認除 #280 外全部內容皆已在 main（PR #214 雖為 CLOSED 未合併，其成果已由 PR #217 重新落地）；殘留 worktree `agent-a7af93c204395bbc0` 已移除

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

1. 內部伺服器首次部署已完成（2026-07-27，見上）。剩餘部署強化，按阻斷性排序：**TLS**（`proxy/Caddyfile` 掛內部網域＋內部 CA；目前全程 HTTP，NFR-SEC-10 未滿足，且為 OIDC/SSO 前置條件）、**SMTP**（未設＝忘記密碼不寄信、只寫 log，使用者無法自助重設）、**備份異機保存**（NFR-DATA-03；目前 `backups` volume 與資料同機）、Ubuntu 18.04 已 EOL 的作業系統升級計畫
2. 串接真實 AI 端點（ANTHROPIC_API_KEY + local BGE-M3）；MCP 讓使用者自助接上知識庫——站內 `/guide#mcp` 為主要路徑（設定片段自動填網域與 token），`docs/guides/mcp-server.md` 為完整參考（每人自建 API token；寫入需勾選 write scope）
3. 其餘 backlog 候選見 #93（變更請求、行內評論、webhooks、PDF 匯出、KaTeX 等，依回饋再拆）
4. 未拆 issue 的殘餘觀察（#232 review 記錄）：跨空間子樹搬移與同空間 reparent 交錯可能產生「parent 在他空間」的懸掛連結（非環、屬 #225 家族），需要時再開 issue
