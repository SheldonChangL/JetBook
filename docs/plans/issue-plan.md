# JetBook Issue Plan（Epic → Feature → Task 完整拆解）

- 文件版本：v1.1（已套用完整性審查修正決議，見 `docs/design/review-report.md` 決議狀態總表）
- 依據：功能需求規格書 v1.1、NFR 與系統架構設計 v1.1、UI/UX 設計規格書 v1.1
- Milestone 定義見 `docs/plans/milestones.md`；依賴鏈與排程見 `docs/plans/dependency-map.md`
- Task 粒度：每個 Task 可在一個 PR 內完成；ID 格式 `{Epic 代碼}-{序號}`
- Title 類型代碼：`chore`（工具鏈/雜項）、`infra`（部署/維運）、`feat`（功能）、`test`（測試）、`spike`（技術驗證）

## v1.1 修訂摘要（相對 delivery v1.0）

| 修正 | 內容 |
|---|---|
| C1 決議 | D-09 對齊軟性編輯鎖決策：`pages.locked_by`/`locked_at`、心跳續租 30s、閒置 5 分鐘自動釋放、Admin 可搶鎖；`current_version_no` 樂觀版本檢查為第二道防線。鎖欄位併入 C-02 schema |
| Schema 一次補齊 | B-01（groups/group_members，C5）、C-01（visibility 三態 C4、commenter 四級角色 C3、授權主體泛化 C5、space_pinned_pages G8、collections 預留 G10）、C-02（pages 鎖欄位 C1、page_slug_history G1、page_visits G9）——Phase 1 建表，避免後改表 |
| 新增 C-13 | 死鏈標示與已刪頁 chip（M3，G5/F-PAGE-08，依賴 D-11、C-08） |
| 新增 M-03 | 孤兒附件 GC job 與儲存用量統計（M3，G6/F-ADMIN-07，依賴 M-01、H-01） |
| 新增 B-08 | 個人設定頁：密碼變更/外觀/通知偏好（M1，G7，依賴 B-02、G-03） |
| C6 對齊 | L-03 補「AI 設定唯讀化」說明：連線設定唯讀（12-factor），無 temperature/max tokens 欄位；僅營運設定（重嵌/開關/quota）可編輯 |

Task 總數：**91**（M0：10、M1：42、M2：16、M3：23）＋ M4 Backlog 彙總 1 項。

---

## EPIC-A：專案骨架與設計系統（M0）

涵蓋 Feature：專案初始化、Docker 拓撲、設定外部化（F-ADMIN-03 基礎）、設計 token、i18n、中文檢索 spike

**A-01｜chore: 初始化 Next.js 專案與工具鏈**
- 摘要：建立 Next.js（App Router）+ TypeScript strict 專案，ESLint/Prettier、路徑別名、`output: standalone`。
- 範圍：`package.json`、`next.config.ts`、`tsconfig.json`、`src/app` 骨架。
- 驗收：`next build` 成功；lint/typecheck 零錯誤；standalone 產物可 `node server.js` 啟動。
- 依賴：無｜Labels：`infra` `dx`｜Milestone：M0

**A-02｜infra: Dockerfile 與 Docker Compose 基礎拓撲**
- 摘要：multi-stage Dockerfile；compose 定義 proxy/web/db；自建 PG16 image（pgvector＋中文斷詞 extension 佔位）；`.env.example`（含 SMTP——G7 決議列 P0 基礎設施）。
- 範圍：`Dockerfile`、`docker-compose.yml`、`db/Dockerfile`、volumes。
- 驗收：`docker compose up` 起全部服務；同 image 只換 env 可變更設定；秘密不入 repo。
- 依賴：A-01｜Labels：`infra` `docker`｜Milestone：M0

**A-03｜feat: 環境變數驗證模組**
- 摘要：`src/lib/env.ts` 以 Zod 驗證全部 env，缺漏 fail-fast（12-factor）。
- 驗收：缺必要變數啟動即報錯並列出缺項；全程式碼經此模組取得設定。
- 依賴：A-01｜Labels：`backend` `config`｜Milestone：M0

**A-04｜feat: Drizzle ORM 與 migration 工作流**
- 摘要：`src/lib/db/`、drizzle-kit 設定、migration 為獨立指令（不在 app 啟動隱式執行）。統一 Drizzle（C9）。
- 驗收：空 schema migration 可套用至 compose DB；CI 驗證 schema 與 migration 一致。
- 依賴：A-02、A-03｜Labels：`backend` `db`｜Milestone：M0

**A-05｜feat: 健康檢查與結構化日誌**
- 摘要：`/api/healthz`（不碰 DB）、`/api/readyz`（驗 DB）、pino JSON logger、request-id。
- 驗收：DB 斷線時 readyz 回 503；log 單行 JSON 含 request-id；compose healthcheck 掛 readyz。
- 依賴：A-04｜Labels：`backend` `observability`｜Milestone：M0

**A-06｜chore: CI pipeline**
- 摘要：PR 跑 lint＋typecheck＋unit test＋build；main 自動建 Docker image 並 tag。
- 驗收：全綠才可 merge；main push 產出可部署 image。
- 依賴：A-01（image 步驟依 A-02）｜Labels：`infra` `ci`｜Milestone：M0

**A-07｜feat: 設計 token 與字型系統**
- 摘要：`globals.css` CSS variables（雙模式色彩/字級/間距/圓角/陰影/focus ring，依 UI 規格 §4.1–4.3）、Tailwind theme 映射、self-host Inter＋Noto Sans TC。
- 驗收：`.dark` class 切換全站變數；字型零外部 CDN 依賴；token 與規格一致。
- 依賴：A-01｜Labels：`frontend` `design-system`｜Milestone：M0

**A-08｜feat: 核心 UI 元件庫（第一批）**
- 摘要：Radix＋Tailwind 自建：Button/IconButton/Input/Select/Combobox/Modal/Drawer/Toast/Tooltip/Popover/Avatar/Badge/Tabs/Skeleton/Kbd/EmptyState。
- 驗收：符合 §4.4 狀態集；focus-visible ring 統一；全鍵盤可操作。
- 依賴：A-07｜Labels：`frontend` `design-system`｜Milestone：M0

**A-09｜feat: i18n 骨架（next-intl）**
- 摘要：`messages/zh-TW.json`、provider 設定、ESLint 禁硬編碼 UI 字串規則。
- 驗收：全部 UI 字串經訊息檔；新增語系僅加 JSON。
- 依賴：A-01｜Labels：`frontend` `i18n`｜Milestone：M0

**A-10｜spike: 中文全文檢索選型驗證（zhparser vs pgroonga）**
- 摘要：以 50–100 份真實文件＋20 條驗收查詢實測斷詞品質、highlight、維運成本（R2；審查傾向 pgroonga），產出 ADR 定案，回寫 db image。
- 驗收：ADR 完成；db image 內建選定 extension；「凱銳光電」查得「凱銳」相關內容測試通過。
- 依賴：A-02｜Labels：`spike` `search` `db`｜Milestone：M0

---

## EPIC-B：認證與授權（M1）

涵蓋：F-SEC-01/02/03(預留)/04/05(核心)/07(寫入)、G7 個人設定

**B-01｜feat: 使用者/Session 資料模型與密碼雜湊**
- 摘要：`users`（含 `auth_provider`/`oidc_subject` OIDC 預留欄位）、`sessions` 表；**schema 一次補齊（C5）：`groups`/`group_members` 表**（授權解析與管理 UI 於 K-03 實作，AD/SSO 群組映射前置）；Argon2id；`lib/auth/session.ts`（token 產生/驗證/撤銷、HttpOnly cookie）。
- 驗收：session hash 存 DB（多副本共用）；登出即失效；Argon2id 參數符 NFR-SEC-02；groups/group_members migration 可套用。
- 依賴：A-04｜Labels：`backend` `auth` `security` `db`｜Milestone：M1

**B-02｜feat: 登入/登出流程與防暴力破解**
- 摘要：登入頁 UI（§3.1）、login/logout、失敗計數遞增延遲、IP rate limit（可插拔 store）。
- 驗收：錯誤訊息不洩漏帳號存在；5 次/分/IP；鎖定顯示剩餘時間。
- 依賴：B-01、A-08、A-09｜Labels：`fullstack` `auth` `security`｜Milestone：M1

**B-03｜feat: 授權核心 lib/authz（唯一權限入口）**
- 摘要：`permission.ts`：`can(user, action, resource)`、`getAccessiblePageIds()`；解析順序 org admin → page restricted → space 角色（**admin/editor/commenter/viewer 四級，C3**）→ visibility（**三態 `private|org_read|org_write`，C4**）→ 預設拒絕；授權主體泛化 `user|group`（C5），SQL 預留群組成員 join（K-03 啟用）。
- 驗收：角色矩陣單元測試覆蓋 ≥80%；所有解析分支有測試；禁止他處散寫權限判斷（lint/約定）。
- 依賴：B-01、C-01、C-02（需 schema）｜Labels：`backend` `security` `critical-path`｜Milestone：M1

**B-04｜feat: 路由保護與 requireSession**
- 摘要：middleware、`requireSession()`（`cache()` 包裝）、未登入導向登入、登入後 returnTo deep link（F-PUB-02 一半）。
- 驗收：未登入訪問內頁 → 登入後回原頁含錨點。
- 依賴：B-01｜Labels：`backend` `auth`｜Milestone：M1

**B-05｜feat: 忘記密碼與 Email 重設**
- 摘要：重設 token 表、SMTP env 外部化（P0 基礎設施，G7）、重設頁與忘記密碼流程 wireframe（v1.1 補畫）。
- 驗收：連結單次有效有時限；重設後撤銷全部 session。
- 依賴：B-02｜Labels：`fullstack` `auth`｜Milestone：M1

**B-06｜feat: OIDC 介面預留（stub）**
- 摘要：`IdentityProvider` 介面、`/api/auth/oidc/*` route 骨架、SSO 按鈕 feature flag。
- 驗收：未設 OIDC env 時不顯示 SSO 按鈕；設測試 issuer 時 authorize URL 正確組出。
- 依賴：B-02｜Labels：`backend` `auth`｜Milestone：M1

**B-07｜feat: 稽核日誌寫入服務**
- 摘要：`audit_logs`（append-only；**已升 Must/P0，C8**）、`lib/audit.ts`；掛點：登入/登出/失敗、權限變更、頁面刪除（後續 task 持續增補掛點）。
- 驗收：事件含 actor/action/target/ip/時間；一般使用者不可讀寫；保留策略符 NFR-SEC-06（1 年）。
- 依賴：B-01｜Labels：`backend` `security` `db`｜Milestone：M1

**B-08｜feat: 個人設定頁（密碼變更/外觀/通知偏好）**（新增，G7）
- 摘要：個人設定 wireframe（v1.1 補畫）三區：密碼變更（驗證舊密碼、成功後撤銷本人其他 session）；外觀（淺色/深色/跟隨系統，與 G-03 profile 同步、跨裝置一致）；通知偏好（站內/Email 各事件類型開關，欄位先落地，K-02/F-NOTIF 於 M3 讀取）。
- 驗收：密碼變更需輸入舊密碼，成功後其他裝置 session 失效並寫入稽核；外觀設定持久化且跨裝置同步；通知偏好儲存成功並於通知發送時被尊重（M3 起生效）。
- 依賴：B-02、G-03｜Labels：`fullstack` `auth`｜Milestone：M1

---

## EPIC-C：Space 與頁面結構（M1 核心＋M3 補強）

涵蓋：F-ORG-01/02/03/04/06、F-PAGE-01~06/08、F-PUB-03

**C-01｜feat: Space 資料模型與 CRUD**
- 摘要：`spaces`（含 `ai_indexing_enabled`、**visibility 三態 `private|org_read|org_write`（C4）**、`collection_id` 預留）、`space_members`（**role 四級 `admin|editor|commenter|viewer`（C3）**）、`org_settings` 表；**schema 一次補齊（C3/C4/C5/G8/G10）**：`space_pinned_pages`（G8 釘選）、`collections` 預留表（G10）、`page_permissions.subject_type` 泛化 `user|group`（C5）；createSpace/updateSpace/setSpaceMember actions；Space 列表頁基本版。
- 驗收：建立者成為 space admin；列表依權限過濾；visibility 三態生效（org_write 允許全員編輯）；補齊 schema migration 一次到位、CI 驗證通過。
- 依賴：B-01、B-04｜Labels：`fullstack` `db` `critical-path`｜Milestone：M1

**C-02｜feat: 頁面資料模型與 CRUD**
- 摘要：`pages` 表（`parent_id`＋fractional `position`、slug、content jsonb、content_md/content_text、search_tsv、deleted_at、**鎖欄位 `locked_by`/`locked_at`/`current_version_no`（C1 決議，D-09 實作）**）；**schema 一次補齊（G1/G9）**：`page_slug_history`（301 導向資料模型，C-05 實作）、`page_visits`（最近瀏覽資料來源，C-06 實作）；createPage/deletePage（軟刪含子樹）。
- 驗收：新頁掛對位置；刪除含子頁提示影響範圍並整支子樹軟刪；補齊 schema migration 一次到位。
- 依賴：C-01｜Labels：`backend` `db` `critical-path`｜Milestone：M1

**C-03｜feat: 頁面樹讀取與 Tree UI**
- 摘要：recursive CTE 整樹查詢、Tree 元件（§4.4/§4.5：收展、鍵盤方向鍵、目前頁高亮）、左側欄整合。
- 驗收：≥5 層巢狀正確；依權限渲染；千節點順暢。
- 依賴：C-02、B-03、A-08、G-01｜Labels：`fullstack` `tree`｜Milestone：M1

**C-04｜feat: 頁面拖曳排序與搬移**
- 摘要：movePage action（fractional index、循環防護）、拖曳互動（插入線、hover 600ms 自動展開、禁拖入子孫）。
- 驗收：拖曳後持久化；拖入自身子孫被即時阻止。
- 依賴：C-03｜Labels：`fullstack` `tree`｜Milestone：M1

**C-05｜feat: Slug 生成與 301 重導向**
- 摘要：中文標題→可讀 slug/短 ID、衝突尾碼；改名時寫入 `page_slug_history`（表由 C-02 建立，G1），路由 resolver 先查現行 slug、fallback 查歷史表回 301。
- 驗收：改標題後舊 URL 導向新址；內部引用不失效。
- 依賴：C-02｜Labels：`backend`｜Milestone：M1

**C-06｜feat: Dashboard 與 Space 首頁**
- 摘要：Dashboard（§3.2 最近更新/最近瀏覽/我的空間）、Space 首頁（§3.3，含**釘選頁面卡片區，F-ORG-06/G8**，最多 6 張、space admin 可釘選/取消，schema 由 C-01 就緒）、`page_visits` 讀寫（upsert、每人保留 N 筆，G9）。
- 驗收：F-PUB-03 驗收；F-ORG-06 驗收（達 6 上限提示；釘選頁被刪或移出自動移除）；全部依權限過濾。
- 依賴：C-03、G-01｜Labels：`frontend`｜Milestone：M1

**C-07｜feat: Space 權限管理 UI**
- 摘要：成員角色表格（§3.10，四級角色，「來源：經由群組」badge 於 K-03 啟用）、visibility 三態 radio＋confirm、最後 admin 保護、自我降權確認。
- 驗收：權限變更下一請求生效；受限 space 對未授權者列表/搜尋/URL 全不可見。
- 依賴：C-01、B-03、A-08｜Labels：`fullstack` `security`｜Milestone：M1

**C-08｜feat: 回收桶**（M3）
- 摘要：trash UI、還原（原父或根層）、30 天排程清除（pg-boss cron，G11）。
- 驗收：F-PAGE-06；回收桶內容不進搜尋與 RAG。
- 依賴：C-02、H-01｜Labels：`fullstack`｜Milestone：M3

**C-09｜feat: Collection 分組**（M3）
- 摘要：collections 巢狀結構（表由 C-01 預留，G10）、Space 拖曳分組、權限向下繼承與覆寫。
- 驗收：F-ORG-03 驗收。
- 依賴：C-01、B-03｜Labels：`fullstack`｜Milestone：M3

**C-10｜feat: 頁面跨 Space 移動/複製**（M3）
- 摘要：跨 space movePage/copyPage；**附件 `attachments.space_id` 歸屬同步轉移（G6）**；slug 歷史與連結導向維持有效。
- 驗收：F-PAGE-05：附件、版本歷史、連結導向仍有效；附件權限跟隨新 space。
- 依賴：C-04、M-02、C-05｜Labels：`backend`｜Milestone：M3

**C-11｜feat: 群組節點與外部連結節點**（M3）
- 摘要：頁面樹群組節點（僅結構、無內容頁）與外部連結節點。
- 驗收：F-PAGE-04。
- 依賴：C-03｜Labels：`fullstack`｜Milestone：M3

**C-12｜feat: Space 封存與軟刪除**（M3）
- 摘要：封存（唯讀、不進搜尋）與軟刪除（30 天可還原，逾期 pg-boss cron 清除，G11）。
- 驗收：F-ORG-04：封存唯讀且不進搜尋；30 天可還原。
- 依賴：C-01、H-01｜Labels：`backend`｜Milestone：M3

**C-13｜feat: 死鏈標示與已刪頁 chip**（M3，新增，G5/F-PAGE-08）
- 摘要：內部頁面連結（page id 為目標）渲染時偵測目標頁已刪除（位於回收桶或已清除），閱讀與編輯模式顯示「已刪除頁面」樣式 chip；具還原權限者可由 chip 直達回收桶還原；還原後連結自動恢復正常渲染。背景死鏈報表列 M4 backlog（F-ADMIN-06）。
- 驗收：F-PAGE-08 v1 驗收兩條（chip 顯示＋直達回收桶；還原後自動恢復）；無還原權限者僅見 chip 不見還原入口。
- 依賴：D-11、C-08｜Labels：`fullstack` `reading`｜Milestone：M3

---

## EPIC-D：編輯器（M1 核心＋M3 進階區塊）

涵蓋：F-EDIT-01~15、F-COLLAB-01

**D-01｜feat: TipTap 編輯器基礎**
- 摘要：editor 元件、doc schema（段落/H1–H3/清單/任務清單/quote/hr；標題層級統一 H1–H3，C11）、行內格式與快捷鍵（編輯模式且有文字選取時 ⌘K＝插入連結，否則＝全域搜尋，C11）、Markdown input rules（`#`、`-`、`>`、`---`）、IME composition 防護；heading/block 節點加持久 `id` attribute（R6 錨點基礎）。一律採現成 TipTap extensions 零自研（R1）。
- 驗收：F-EDIT-03/04/11 與 Markdown 快捷輸入驗收；選字中不誤觸發快捷鍵。
- 依賴：A-08｜Labels：`frontend` `editor` `critical-path`｜Milestone：M1

**D-02｜feat: 內容儲存管線與 autosave**
- 摘要：savePage action（同交易：JSON→content_md/content_text 衍生、tsvector 更新、`current_version_no` 樂觀鎖版本號檢查）、autosave ≥2s debounce、儲存狀態指示、sanitize 渲染防 stored XSS；連線中斷提示＋編輯器記憶體保留＋自動重試儲存（不承諾本機持久化，C7）。
- 驗收：版本號不符拒寫並提示重載；三份衍生資料不可能不同步；離頁未存有防護；中斷時顯示「網路連線中斷，請勿關閉分頁」並自動重試。
- 依賴：D-01、C-02｜Labels：`fullstack` `editor` `security` `critical-path`｜Milestone：M1

**D-03｜feat: Slash 指令選單**
- 摘要：slash 選單依 F-EDIT 優先級排序（C11）。
- 驗收：F-EDIT-02：中英文關鍵字過濾（「表格」/"table" 皆命中）、全鍵盤、涵蓋所有已實作區塊。
- 依賴：D-01｜Labels：`frontend` `editor`｜Milestone：M1

**D-04｜feat: 程式碼區塊**
- 摘要：程式碼區塊（現成 lowlight extension）。
- 驗收：F-EDIT-06：≥20 語言高亮、語言搜尋下拉、行號、閱讀端複製鈕、Esc 跳出。
- 依賴：D-01｜Labels：`frontend` `editor`｜Milestone：M1

**D-05｜feat: 表格區塊**
- 摘要：表格區塊（TipTap table extension）。
- 驗收：F-EDIT-07：增刪列欄不失資料、表頭 toggle、欄寬拖曳、閱讀端水平捲動。
- 依賴：D-01、D-03｜Labels：`frontend` `editor`｜Milestone：M1

**D-06｜feat: 提示區塊（Callout/Hint）**
- 摘要：四種語意樣式 callout。
- 驗收：F-EDIT-08：四種語意樣式、切換不失內容、左緣 3px 色條視覺。
- 依賴：D-01、D-03｜Labels：`frontend` `editor`｜Milestone：M1

**D-07｜feat: 圖片區塊與上傳整合**
- 摘要：圖片區塊接 M-01 上傳 API。
- 驗收：F-EDIT-09：drop/paste 自動上傳、進度與失敗重試、alt/圖說、尺寸吸附、閱讀端 lightbox。
- 依賴：D-01、M-01｜Labels：`fullstack` `editor` `files`｜Milestone：M1

**D-08｜feat: 檔案附件區塊**
- 摘要：附件卡片區塊接 M-01/M-02。
- 驗收：F-EDIT-10：附件卡片（檔名/大小/下載）、下載經權限、副檔名與大小上限可設定。
- 依賴：D-01、M-01、M-02｜Labels：`fullstack` `editor` `files`｜Milestone：M1

**D-09｜feat: 編輯鎖與衝突防護**（C1 決議定案）
- 摘要：**軟性編輯鎖**——進入編輯取得鎖（`pages.locked_by`/`locked_at`，欄位由 C-02 建立）、**心跳續租 30s**、**閒置 5 分鐘自動釋放**、**Admin 可搶鎖**（確認 modal，原持有者即時降級唯讀並提示）；他人「編輯中」唯讀 banner；`acquireLock`/`heartbeat`/`releaseLock` actions；與 D-02 `current_version_no` 樂觀版本檢查互補（樂觀檢查失敗時顯示衝突備援畫面）；附併發狀態機設計短文（R5）。
- 驗收：F-COLLAB-01 全部三條驗收；心跳中止後 5 分鐘內鎖自動釋放；Admin 搶鎖後原持有者被降級唯讀且有提示；雙人同時編輯情境列入 N-02 E2E 必測。
- 依賴：D-02｜Labels：`fullstack` `editor`｜Milestone：M1

**D-10｜feat: Markdown 貼上解析**
- 摘要：貼上多段 Markdown 轉區塊。
- 驗收：F-EDIT-05：貼上多段 Markdown（含 code block、表格）正確轉為區塊。
- 依賴：D-01、D-04、D-05｜Labels：`frontend` `editor`｜Milestone：M1

**D-11｜feat: 頁面連結與 @mention**（M3）
- 摘要：頁面搜尋插連結（以 page id 為目標，改名不失效）、成員 mention 觸發通知（K-02）。
- 驗收：F-EDIT-12：頁面搜尋插連結、改名自動更新、成員 mention 觸發通知；目標被刪時由 C-13 顯示已刪頁 chip。
- 依賴：C-05、K-02｜Labels：`fullstack` `editor`｜Milestone：M3

**D-12｜feat: Tabs/摺疊/Stepper 區塊**（M3）
- 摘要：三種容器區塊（現成 extensions）。
- 驗收：F-EDIT-13：互動正常、內部文字進搜尋與 RAG 索引。
- 依賴：D-01、H-05｜Labels：`frontend` `editor`｜Milestone：M3

**D-13｜feat: Mermaid 圖表區塊**（M3）
- 摘要：Mermaid 區塊（即時預覽）。
- 驗收：F-EDIT-14：即時預覽、語法錯誤不崩頁。
- 依賴：D-01｜Labels：`frontend` `editor`｜Milestone：M3

**D-14｜feat: Embed 區塊（網域白名單）**（M3）
- 摘要：iframe embed，白名單由管理者設定（L-01 後台）。
- 驗收：F-EDIT-15：白名單由管理者設定、不支援者退化為連結卡片。
- 依賴：D-01、L-01｜Labels：`fullstack` `editor`｜Milestone：M3

---

## EPIC-M：檔案儲存（M1＋M3）

涵蓋：F-SEC-08、F-ADMIN-07、附件基礎

**M-01｜feat: StorageProvider 抽象與本地實作＋上傳 API**
- 摘要：`lib/storage/`（provider.ts/local.ts）、`/api/upload`、`attachments` 表、MIME＋副檔名雙白名單、UUID 檔名重寫、大小上限 env。
- 驗收：換 env 可指向不同儲存根（未來 S3/MinIO 只加實作）；超限/非法型別有明確錯誤。
- 依賴：A-03、A-04、B-04｜Labels：`backend` `files` `security`｜Milestone：M1

**M-02｜feat: 附件下載與權限保護**
- 摘要：`/api/files/[id]` streaming、頁面權限檢查、`Content-Disposition`/`Content-Type` 正確設定。
- 驗收：未授權 403、無可猜測公開 URL；HTML 附件不 inline；50MB streaming 不爆記憶體。
- 依賴：M-01、B-03｜Labels：`backend` `files` `security`｜Milestone：M1

**M-03｜feat: 孤兒附件 GC job 與儲存用量統計**（M3，新增，G6/F-ADMIN-07）
- 摘要：內容引用計數追蹤附件使用狀態；頁面刪除或內容移除引用後成為孤兒附件，經 **30 天寬限期**由背景 GC job（pg-boss cron，G11）回收，清除寫入稽核日誌；管理後台儲存用量卡片（全站與各 Space 附件數/用量）。
- 驗收：F-ADMIN-07 兩條驗收：寬限期內重新被引用（頁面/版本還原）不被回收，逾期清除並寫稽核；後台顯示全站與各 Space 附件數量與儲存用量。
- 依賴：M-01、H-01｜Labels：`backend` `files` `jobs` `admin`｜Milestone：M3

---

## EPIC-E：版本控制（M1＋M3）

涵蓋：F-VER-01~04

**E-01｜feat: 自動版本快照**
- 摘要：`page_versions` 表、editing session 合併規則（鎖釋放或靜止 5 分產生快照，完整 JSON）——與 D-09 軟鎖生命週期對齊。
- 驗收：F-VER-01：高頻編輯合併為單一版本；含作者與時間。
- 依賴：D-02、D-09｜Labels：`backend` `versioning` `db`｜Milestone：M1

**E-02｜feat: 版本歷史檢視 UI**
- 摘要：§3.8 左欄時間軸列表＋右欄快照唯讀渲染。
- 驗收：F-VER-02：歷史版本渲染與當時內容一致。
- 依賴：E-01、G-02｜Labels：`frontend` `versioning`｜Milestone：M1

**E-03｜feat: 版本還原**
- 摘要：還原為新版本（不可變歷史）。
- 驗收：F-VER-03：還原產生新版本、confirm modal 說明。
- 依賴：E-02｜Labels：`fullstack` `versioning`｜Milestone：M1

**E-04｜feat: 版本差異比較（Diff）**（M3）
- 摘要：任兩版比較；中文無斜體改強調底色、中文字詞級 diff。
- 驗收：F-VER-04：block 級標示＋中文字詞級 diff、任兩版比較。
- 依賴：E-02｜Labels：`frontend` `versioning`｜Milestone：M3

---

## EPIC-F：搜尋（M1＋M3）

涵蓋：F-SEARCH-01/02/03

**F-01｜feat: 全文搜尋後端（中文斷詞）**
- 摘要：依 A-10 定案配置 tsvector＋GIN、search API（權限過濾在 SQL、標題加權、命中 highlight）。
- 驗收：F-SEARCH-01 全部；種子資料下 P95 < 500ms（NFR 表為唯一來源，C10）；權限過濾有整合測試。
- 依賴：A-10、D-02、B-03｜Labels：`backend` `search` `critical-path`｜Milestone：M1

**F-02｜feat: Cmd+K 搜尋面板**
- 摘要：CommandPalette 複合元件（§3.6）：typeahead、鍵盤導航、IME 處理、最近瀏覽（page_visits）、預留「問 AI」列位置；「顯示全部 N 筆」導向完整搜尋結果頁（F-03，M3）。
- 驗收：F-SEARCH-02：任頁可呼出、typeahead P95 200ms（C10）、全鍵盤。
- 依賴：F-01、A-08、G-01｜Labels：`frontend` `search`｜Milestone：M1

**F-03｜feat: 搜尋結果頁與過濾器**（M3）
- 摘要：完整搜尋結果頁 wireframe（v1.1 補畫，G7），承載過濾器。
- 驗收：F-SEARCH-03：Space/時間/作者過濾可組合。
- 依賴：F-01｜Labels：`fullstack` `search`｜Milestone：M3

---

## EPIC-G：App Shell 與閱讀模式（M1）

涵蓋：F-PUB-01/02、F-EDIT-19、UI 規格 §1–§3

**G-01｜feat: App Shell 三欄版面**
- 摘要：頂部列（56px）、左側欄收合（`⌘\`、寬度拖曳與記憶、overlay 熱區）、RWD 四段斷點、路由進度條。
- 驗收：§2 全部版面規格；md 以下側欄轉抽屜。
- 依賴：A-08、B-04｜Labels：`frontend` `layout`｜Milestone：M1

**G-02｜feat: 文件閱讀頁**
- 摘要：RSC block 渲染器（與編輯器 schema 一一對應）、右欄 TOC scroll-spy（F-EDIT-19，取 H2/H3，C11）、麵包屑、metadata 列、上/下一頁、H2/H3 錨點複製。
- 驗收：F-PUB-01：Reader 零編輯 UI；TTFB P95 < 500ms；RWD 可讀。
- 依賴：C-03、D-01（schema 對齊）、G-01｜Labels：`frontend` `reading` `critical-path`｜Milestone：M1

**G-03｜feat: 深色模式**
- 摘要：三段設定（淺/深/系統）、head inline script 防 FOUC、profile 同步（設定入口在 B-08 個人設定頁）。
- 驗收：三段設定生效；雙模式 AA 對比；跨裝置同步。
- 依賴：A-07、G-01｜Labels：`frontend`｜Milestone：M1

**G-04｜feat: 錯誤頁與空狀態**
- 摘要：§3.12：403/404/500/離線 banner；空狀態統一模板。403「向管理員申請權限」（F-SEC-10，複用 notifications）於 K-02 上線後啟用，M1 先顯示 Space 管理員資訊。
- 驗收：§3.12 全部狀態頁；空狀態統一模板。
- 依賴：G-01｜Labels：`frontend`｜Milestone：M1

**G-05｜feat: 頁面分享連結與錨點 deep link**
- 摘要：複製連結（含錨點）；未登入開啟 → 登入後直達原位置。
- 驗收：F-PUB-02 全部。
- 依賴：G-02、B-04｜Labels：`fullstack`｜Milestone：M1

---

## EPIC-L：管理後台（M1 部分＋M3）

涵蓋：F-ADMIN-01/02/03/04/05

**L-01｜feat: 管理後台骨架與使用者管理**
- 摘要：admin layout（§3.11）、使用者建立/邀請（首登設密碼流程 wireframe，G7）/停用/重設密碼/角色指派；停用即撤銷全部 session。
- 驗收：F-ADMIN-01 全部；僅 org admin 可進入。
- 依賴：B-01、B-03、A-08｜Labels：`fullstack` `admin`｜Milestone：M1

**L-02｜feat: 系統設定健康檢查頁**
- 摘要：唯讀顯示 DB/儲存/SMTP/（M2 回填 LLM）連線狀態，秘密遮罩。
- 驗收：F-ADMIN-03 驗收第 2 條。
- 依賴：A-05、L-01｜Labels：`fullstack` `admin`｜Milestone：M1

**L-03｜feat: AI 設定與用量後台頁**（M3）
- 摘要：**AI 設定唯讀化（C6 決議）**——連線設定（provider、模型 ID、Base URL、API key 末四碼遮罩）一律唯讀顯示，值來自環境變數（12-factor，NFR-MAINT-05/NFR-COMP-01；變更需改 env 重佈）；**不提供 temperature/max tokens 等 sampling 參數欄位**（LLM 抽象層不暴露 sampling 參數，claude-sonnet-5 拒非預設 temperature）；附 [測試連線] 按鈕。可編輯者僅限 DB 儲存之營運設定：重嵌觸發（含進度與失敗清單）、AI 功能開關、quota 欄位（I-09 強制執行）；用量統計圖。
- 驗收：F-ADMIN-04；連線設定區無任何可編輯欄位、無 sampling 參數；測試連線回報成功/失敗原因；重嵌有進度與失敗清單可重試。
- 依賴：H-07、I-06、L-01｜Labels：`fullstack` `admin` `ai`｜Milestone：M3

**L-04｜feat: 稽核日誌檢視**（M3）
- 摘要：多條件過濾、展開詳情、CSV 匯出、cursor 分頁。
- 驗收：F-ADMIN-05 全部。
- 依賴：B-07、L-01｜Labels：`fullstack` `admin` `security`｜Milestone：M3

---

## EPIC-N：品質與維運（跨 milestone）

**N-01｜test: 權限整合測試基礎建設**
- 摘要：Vitest＋testcontainers（真 PG）、seed 工具；覆蓋 B-03 角色矩陣（四級角色×三態 visibility）與 F-01 搜尋權限過濾。
- 驗收：CI 可跑真 PG 整合測試；權限案例全綠（NFR-MAINT-01）。
- 依賴：B-03、A-06｜Labels：`test` `security`｜Milestone：M1

**N-02｜test: E2E 冒煙流程（MVP 驗收閘門）**
- 摘要：Playwright：登入→建 Space→建頁→編輯（含圖片）→閱讀→搜尋→權限（私有 space 不可見）→**雙人同時編輯鎖情境（R5）**。
- 驗收：CI 可跑；全綠為 M1 出貨條件。
- 依賴：M1 主鏈全部（B-02、C-04、C-07、D-07、D-09、E-03、F-02、G-02、L-01、M-02、N-03）｜Labels：`test` `e2e`｜Milestone：M1

**N-03｜infra: 備份機制與還原 runbook**
- 摘要：backup 容器（pg_dump 每日＋WAL 歸檔＋restic 附件增量至異機）、還原文件；**已升 Must/P0（C8）**；runbook 聲明 DB dump 與附件備份時間點不一致視窗之可接受範圍。
- 驗收：NFR-DATA-01~03（RPO 1h/RTO 4h）；乾淨環境依 runbook 完整還原一次成功。
- 依賴：A-02｜Labels：`infra` `ops`｜Milestone：M1

**N-04｜test: RAG 權限隔離自動化測試（M2 出貨阻斷）**
- 摘要：專屬整合測試：私有 space／`ai_indexing_enabled=false` 內容在任何情境下不得出現於檢索結果、prompt context 或引用；含 golden question 檢索評測集（30–50 題，R3）基準。
- 驗收：NFR-SEC-05；納入 CI 必跑。
- 依賴：I-01、N-01｜Labels：`test` `security` `ai` `release-blocker`｜Milestone：M2

**N-05｜feat: Prometheus metrics endpoint**（M3）
- 摘要：HTTP 延遲、佇列深度、LLM token 用量/延遲。
- 驗收：NFR-OBS-03/04。
- 依賴：A-05、H-06｜Labels：`backend` `observability`｜Milestone：M3

---

## EPIC-H：AI 平台基礎（M2）

涵蓋：F-AI-01/02/03、NFR-COMP-01/03

**H-01｜infra: pg-boss 佇列與 worker 容器**
- 摘要：`lib/jobs/queue.ts`、`src/worker.ts` entrypoint、compose worker 服務（同 image 不同 command）、graceful shutdown、重試/死信；**worker 職責含 cron jobs（G11）**：回收桶 30 天清除、Space 軟刪逾期清除、過期 session 清理、audit 分區維護、附件 GC（各由對應 task 掛入）。
- 驗收：worker 重啟後續跑未完成 job（NFR-AVAIL-04）；SIGTERM 完成手上 job 再退出；cron 排程可註冊並觸發。
- 依賴：A-02、A-04｜Labels：`infra` `backend` `jobs`｜Milestone：M2

**H-02｜feat: LLM Provider 抽象層＋AnthropicProvider**
- 摘要：`lib/llm/provider.ts` 介面（`tier: primary|light`、chatStream/chat、usage；**不暴露 sampling 參數**）、anthropic.ts 實作、factory by env。
- 驗收：F-AI-01：streaming 與 token 用量回報；模型 ID 全 env 化。
- 依賴：A-03｜Labels：`backend` `ai` `critical-path`｜Milestone：M2

**H-03｜feat: OpenAICompatProvider（Ollama/vLLM）**
- 摘要：fetch＋SSE 解析實作 chat completions 相容層。
- 驗收：只改 env 從 Claude 切至 local endpoint，RAG 不改碼可運作（NFR-COMP-01）。
- 依賴：H-02｜Labels：`backend` `ai`｜Milestone：M2

**H-04｜feat: EmbeddingProvider 抽象與 BGE-M3 接入**
- 摘要：embedding 介面（model/dimensions 中繼資料）、OpenAI-compatible embedding 實作（day-1 local BGE-M3、1024 維）；拒絕混用不同模型/維度向量。
- 驗收：F-AI-02 驗收第 2 條；維度不符時明確報錯。
- 依賴：H-02（介面共置）｜Labels：`backend` `ai`｜Milestone：M2

**H-05｜feat: 內容 Chunker**
- 摘要：以 content_md 依 heading 階層切塊（300–500 tokens、上限 800、10–15% overlap、context header、表格/代碼不切斷）；chunk 錨點記 **block 持久 id（R6）**而非文字路徑；純函式＋完整單測。
- 驗收：切塊保留頁面 ID 與 block id 錨點；邊界案例（超長段落、無標題頁）有測試。
- 依賴：D-02｜Labels：`backend` `ai` `rag`｜Milestone：M2

**H-06｜feat: Embedding 索引管線**
- 摘要：`page_embeddings` 表（vector(1024)＋HNSW、unique(page_id, chunk_index)）、embed-page job（content_hash 增量、孤兒清理、存檔 debounce enqueue）、刪頁/軟刪清除向量。
- 驗收：F-AI-03：更新後 60s 內可語意檢索（C10）；失敗重試與死信不阻塞編輯。
- 依賴：H-01、H-04、H-05｜Labels：`backend` `ai` `jobs` `db` `critical-path`｜Milestone：M2

**H-07｜feat: 全庫重嵌 job 與 AI 索引排除**
- 摘要：reindex-all job（批次＋斷點續跑＋進度回報、失敗清單，R3）；`ai_indexing_enabled=false` 空間跳過索引並清除既有向量；**維度變更＝四步 migration 流程文件化（G4）**：migration（新欄/新表）→ 全量重嵌 → 切換 → 清理。
- 驗收：F-AI-02 換模型可重建；NFR-COMP-03：排除空間內容永不外送；維度變更流程入架構文件。
- 依賴：H-06｜Labels：`backend` `ai` `jobs`｜Milestone：M2

---

## EPIC-I：RAG 功能（M2 核心＋M3 延伸）

涵蓋：F-AI-04/05/06/07/08/11

**I-01｜feat: Hybrid Retriever（權限過濾）**
- 摘要：`lib/rag/retriever.ts`：全文＋向量兩路查詢、RRF 融合 top 8–12；**權限以 SQL JOIN 過濾（非事後過濾）**；排除 AI 索引旗標空間；pgvector ≥0.8 iterative index scan＋over-fetch（k=40 取 20）＋`hnsw.ef_search` 調校（R4）；golden question 評測集（30–50 題，R3）作為檢索品質基準。
- 驗收：語意近義查詢可命中；N-04 權限隔離測試通過；golden question 基準達標。
- 依賴：H-06、F-01、B-03｜Labels：`backend` `ai` `rag` `security` `critical-path`｜Milestone：M2

**I-02｜feat: RAG 問答 API（SSE）**
- 摘要：`/api/ai/chat`：檢索→prompt 組裝（引用編號、繁中指示、不足即明說）→streaming；事件序 `sources → delta → done(usage)`；無檢索結果不呼叫 LLM。
- 驗收：F-AI-04 全部三條；TTFT P95 < 4s（C10）；usage 入記錄。
- 依賴：I-01、H-02｜Labels：`backend` `ai` `rag` `critical-path`｜Milestone：M2

**I-03｜feat: AI 問答抽屜 UI**
- 摘要：§3.7：右側抽屜（420px，AI 介面以抽屜為主，C12）、串流渲染＋停止生成、引用 [n] chips 與來源卡片、context chips、IME Enter 防護、錯誤態與重試。
- 驗收：LLM 故障時搜尋/閱讀/編輯不受影響（NFR-AVAIL-02）、錯誤明確呈現。
- 依賴：I-02、A-08、G-01｜Labels：`frontend` `ai`｜Milestone：M2

**I-04｜feat: 引用跳轉與段落高亮**
- 摘要：chunk block id 錨點（R6）→ 開啟來源頁、捲動至對應區塊、2s 高亮。
- 驗收：F-AI-05。
- 依賴：I-03、G-02、H-05（錨點資料）｜Labels：`frontend` `ai`｜Milestone：M2

**I-05｜feat: 語意搜尋整合 Cmd+K**
- 摘要：搜尋面板加 semantic 區（400ms debounce、固定高度骨架佔位）、「✦ 問 AI」第一列轉入抽屜。
- 驗收：F-AI-06：近義表述命中未含原詞頁面；權限過濾。
- 依賴：I-01、F-02、I-03｜Labels：`fullstack` `ai` `search`｜Milestone：M2

**I-06｜feat: AI rate limit 與用量記錄**
- 摘要：AI 端點 20 次/分/使用者、429＋Retry-After；`ai_usage` 表（G3）記 model/tokens/latency/使用者。
- 驗收：超限拒絕且前端提示；用量可按使用者/功能分項查詢。
- 依賴：I-02、B-07｜Labels：`backend` `ai` `security`｜Milestone：M2

**I-07｜feat: 多輪對話與歷史**（M3）
- 摘要：`ai_conversations`/`ai_messages` 表（**含檢索到的 chunk 引用快照，供稽核與回饋分析，G3**）、追問 query rewrite（light tier）、歷史列表（本人＋admin 可見）。
- 驗收：F-AI-07。
- 依賴：I-02、H-02｜Labels：`fullstack` `ai`｜Milestone：M3

**I-08｜feat: 編輯器寫作輔助**（M3）
- 摘要：`/api/ai/assist`（SSE）、選取浮動工具列 AI 選單（改寫/摘要/翻譯/修正）、結果「取代/插入下方/捨棄」確認流。
- 驗收：F-AI-08：永不直接覆寫原文。
- 依賴：H-02、D-01、I-06｜Labels：`fullstack` `ai` `editor`｜Milestone：M3

**I-09｜feat: AI 用量治理（quota）**（M3）
- 摘要：每人/每日額度設定與強制（route handler 為強制執行點，G3）、超額前後端行為。
- 驗收：F-AI-11。
- 依賴：I-06、L-03｜Labels：`backend` `ai` `admin`｜Milestone：M3

---

## EPIC-J：匯入匯出（M2＋M3）

涵蓋：F-IE-01/02/05（F-IE-05 備份併入 N-03）

**J-01｜feat: Markdown → 編輯器 JSON 轉換器＋單檔匯入**
- 摘要：md parser → TipTap JSON（標題/清單/表格/代碼/圖片/quote）、單檔 .md 匯入 UI。
- 驗收：F-IE-01 驗收第 1 條；轉換器有 fixture 單測。
- 依賴：D-01、C-02｜Labels：`backend` `import`｜Milestone：M2

**J-02｜feat: Zip 批次匯入（資料夾→頁面樹）**
- 摘要：匯入精靈 UI（G2：上傳 zip → 結構預覽對應頁面樹 → 進度 → 成功/失敗報告）、`import-markdown` 背景 job、圖片上傳與引用改寫；**zip 安全（G2）**：zip bomb 上限、路徑穿越檢查、單檔大小限制。
- 驗收：F-IE-01 驗收第 2 條；惡意 zip（bomb/穿越）被拒且有明確錯誤。
- 依賴：J-01、M-01、H-01、C-04｜Labels：`backend` `import` `jobs`｜Milestone：M2

**J-03｜feat: Markdown 匯出（單頁/整 Space zip）**（M3）
- 摘要：export job（單頁 .md／整 Space zip 含附件）。
- 驗收：F-IE-02：round-trip 不失主要結構。
- 依賴：D-02、H-01、J-01｜Labels：`backend` `export`｜Milestone：M3

---

## EPIC-K：協作與通知（M3）

涵蓋：F-COLLAB-02、F-NOTIF-01、F-SEC-06、F-ADMIN-02

**K-01｜feat: 頁面留言**
- 摘要：`comments` 表（討論串、resolve）、評論側欄 UI（§3.9 頁面級）、樂觀更新；commenter 角色（C3）自此啟用留言能力。
- 驗收：F-COLLAB-02：回覆/編輯/刪除/已解決收合；commenter 可留言不可編輯頁面。
- 依賴：G-02、B-03｜Labels：`fullstack` `collab`｜Milestone：M3

**K-02｜feat: 站內通知中心**
- 摘要：`notifications` 表、鈴鐺與未讀計數、通知中心面板 wireframe（v1.1 補畫，G7）、mention/留言回覆/權限申請（F-SEC-10 複用 notifications，G8）事件、點擊直達；尊重 B-08 通知偏好。
- 驗收：F-NOTIF-01。
- 依賴：K-01｜Labels：`fullstack` `collab`｜Milestone：M3

**K-03｜feat: 使用者群組（Teams）**
- 摘要：authz 擴充（群組授權解析——`getAccessiblePageIds` join `group_members`，schema 已於 B-01 建立、主體泛化已於 C-01 就緒，C5）、管理 UI（含 CSV 匯入成員）、成員表格「來源：經由群組」badge（C-07 啟用）。
- 驗收：F-SEC-06：移出群組即失效；F-ADMIN-02；N-01 權限回歸測試擴充群組案例全綠。
- 依賴：B-03、L-01、N-01（回歸測試擴充）｜Labels：`fullstack` `security` `admin`｜Milestone：M3

---

## M4 Backlog（M3 結束前再拆 task）

單一彙總 issue 追蹤，屆時依實際使用回饋擇項拆解為正式 task。候選清單見 `docs/plans/milestones.md` §M4：F-COLLAB-03（變更請求，v1.x 首要，schema 預留設計已入架構文件，G10）、F-COLLAB-04、F-API-01~04（REST API/Token/Webhooks/MCP Server）、F-IE-03/04、F-EDIT-16/17/18、F-ORG-05、F-PAGE-07、F-NOTIF-02/03、F-ADMIN-06（含死鏈報表 v1.x，G5）、F-AI-09/10/12（F-AI-12 含 chunk 快照，G3）。
