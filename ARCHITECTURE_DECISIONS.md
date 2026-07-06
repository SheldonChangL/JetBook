# JetBook — Architecture Decision Records（ADR）

> 本文件記錄 JetBook 的架構層級決策及其取捨。每則 ADR 一經接受即為專案約束，
> 推翻或修改須新增一則 ADR 並將舊者標記為「已取代（Superseded by ADR-xxx）」，不得就地改寫歷史。
> 詳細架構論證見 `docs/architecture/system-architecture.md`（v1.1）；
> 審查編號（C1–C12／G1–G11／R1–R6）對應 `docs/design/review-report.md`。

| 編號 | 標題 | 狀態 | 對應審查編號 |
|---|---|---|---|
| ADR-001 | 頁面樹採鄰接表 `parent_id` ＋ fractional index | 已接受 | — |
| ADR-002 | TipTap/ProseMirror JSON 為 canonical 內容格式 | 已接受 | — |
| ADR-003 | 背景佇列採 pg-boss，不引入 Redis | 已接受 | — |
| ADR-004 | DB-backed opaque session（Lucia 模式），不用 JWT | 已接受 | — |
| ADR-005 | Embedding day-1 採 local BGE-M3（1024 維） | 已接受 | G4／R3 |
| ADR-006 | v1 併發控制採軟性編輯鎖＋樂觀版本檢查 | 已接受 | C1／R5 |
| ADR-007 | 中文全文檢索選型待 M0 spike 定案（傾向 pgroonga） | 已接受（暫定） | R2／C12 |
| ADR-008 | 版本歷史存完整 JSON 快照，diff 顯示時計算 | 已接受 | — |
| ADR-009 | LLM Provider 抽象層不暴露 sampling 參數 | 已接受 | C6 |
| ADR-010 | v1 採直接編輯，無草稿/發布閘門 | 已接受 | C2 |

---

## ADR-001：頁面樹採鄰接表 `parent_id` ＋ fractional index，否決 materialized path

- **狀態**：已接受
- **日期**：2026-07-06

### 背景

JetBook 的頁面組織為 Space 內的樹狀結構（支援 5 層以上巢狀、拖曳搬移/重排，見 F-PAGE-01）。
樹的儲存方式常見三種：鄰接表（adjacency list，`parent_id` 自參照）、materialized path（每列存完整路徑字串）、closure table。
知識庫的存取模式特徵是：整棵 space 樹經常整包載入供側欄渲染；**最頻繁的寫入操作是搬移與重排**；規模預估 10 萬頁、單一 space 通常數千頁，全部跑在內網 PostgreSQL 16 上。

### 決策

`pages` 表採**鄰接表**：`parent_id`（uuid，自參照 fk，nullable）表達父子關係，
搭配 **fractional index** 排序鍵 `position`（double，插入兩節點間取中值）表達兄弟順序。
**否決 materialized path**。讀取整棵樹用 recursive CTE（或 `WHERE space_id = ?` 整包撈出後前端組裝）；
麵包屑（breadcrumb）以 recursive CTE 向上查詢。

### 取捨與後果

- **得**：搬移子樹只需改一列的 `parent_id` + `position`（O(1)），拖曳排序免重排兄弟節點；materialized path 搬移大子樹須在交易內 UPDATE 整棵子樹的 path，成本高且鎖持久。
- **得**：schema 最簡單、無 path 字串長度上限、無 path 同步失敗風險。
- **失**：讀子樹/祖先鏈需 recursive CTE，比 path 前綴查詢多一層遞迴——但在「數千頁/space、內網延遲」的規模下實測毫無壓力，且側欄樹本來就整包載入。
- **後續**：若 breadcrumb 查詢日後成為熱點，加非正規化的 `path_cache` 欄位即可，屬可後補的最佳化而非架構變更。
- **約束**：所有樹操作（搬移/重排/軟刪除）一律走 `movePage`/`deletePage` 等 Server Actions，維持 `position` 的 fractional index 不變量。

---

## ADR-002：TipTap/ProseMirror JSON 為 canonical 內容格式，`content_md`/`content_text` 同交易衍生

- **狀態**：已接受
- **日期**：2026-07-06

### 背景

編輯器選型為 TipTap 2（ProseMirror 生態）。同一份內容有三種消費場景：
（1）編輯器 round-trip 與版本快照；（2）Markdown 匯出與 RAG chunking（LLM 對 markdown 結構理解最好）；（3）中文全文檢索的 `tsvector` 索引。
候選 canonical 格式有二：ProseMirror JSON 或 markdown。

### 決策

**Canonical 格式為 TipTap/ProseMirror JSON**，存於 `pages.content`（jsonb）。
每次存檔時由 server 端在**同一次資料庫交易內**統一衍生並寫入 `content_md`（markdown）與 `content_text`（純文字，餵 `search_tsv`）。
**否決「markdown 為 canonical」**。JSON 內的 heading/block 節點帶持久 `id` attribute（R6，供引用錨點）。

### 取捨與後果

- **得**：無損 round-trip——callout、表格、mention、附件嵌入等自訂節點在 markdown 中會失真，JSON 是編輯器原生格式零損耗。
- **得**：ProseMirror JSON 有嚴格 schema，可做節點級 diff；未來若加即時協作（Yjs）也是同一生態（見 ADR-006 的 v2 路徑）。
- **得**：衍生格式各司其職且**不可能不同步**——單一來源為 JSON、同交易轉換，不存在三份資料漂移的失敗模式。
- **失**：儲存三份資料（jsonb + 兩個 text 欄位），空間成本可接受（jsonb TOAST 自動壓縮）。
- **失**：JSON 綁定 TipTap schema，schema 演進需要 migration——以「schema version 欄位＋讀取時 lazy upgrade」緩解。
- **否決理由**：markdown canonical 會迫使所有進階編輯功能塞進 markdown 方言，行內註解 anchor、mention、持久 block id 等都難以穩定表達。

---

## ADR-003：背景佇列採 pg-boss，不引入 Redis

- **狀態**：已接受
- **日期**：2026-07-06

### 背景

系統需要可靠的背景工作佇列：embedding 索引（含 debounce 與增量重算）、匯出（md/html）、附件掃描、
排程清理 job（回收桶到期清除、附件 GC、session 清理，G11）、全量 `reindex-all`。
傳統做法是 Redis + BullMQ，但那會為部署拓撲增加一個有狀態元件，
與「先 Docker Compose、未來遷 K8s、狀態全部集中於 PostgreSQL + 物件儲存」的部署原則相衝。

### 決策

背景佇列採 **pg-boss**（MIT），以現有 PostgreSQL 實作可靠 job（基於 `SKIP LOCKED`，內建 retry、排程、archive、分散式鎖派發）。
**不引入 Redis**。worker 與 web 共用同一個 Docker image、不同 entrypoint（`next start` vs `node worker.js`）。

### 取捨與後果

- **得**：少一個有狀態服務——備份、監控、K8s 遷移都只需面對 PG 一套；job 入列可與業務寫入同交易（存檔＋enqueue embedding 原子化）。
- **得**：pg-boss 天然支援多 worker 競爭消費與分散式排程鎖，K8s 時 worker Deployment 可直接水平擴展。
- **失**：吞吐上限低於 Redis 佇列（每 job 都是 PG 寫入）；內部知識庫的 job 量（存檔觸發的 embedding、日常匯出）遠低於此上限。
- **後續**：若未來 job 量級成長到 PG 佇列成為瓶頸（監控 `queue depth` metrics 可見），屆時再演進為專用佇列——lib/jobs/queue.ts 為唯一入列入口，替換面窄。
- **約束**：rate limit 計數器等跨請求狀態同樣不得依賴本機記憶體，設計為可插拔 store（初期亦落在 PG）。

---

## ADR-004：DB-backed opaque session（Lucia 模式），不用 JWT

- **狀態**：已接受
- **日期**：2026-07-06

### 背景

JetBook 為內部系統，認證需求＝本地帳號（Argon2id）＋ DB session ＋ **即時撤銷**（離職停權必須立刻生效，NFR-SEC 系列）＋ 未來 OIDC/SSO（Azure AD）預留。
候選方案：stateless JWT、Auth.js（NextAuth）、自建 DB session。
Auth.js 對「credentials ＋ database session」的組合支援彆扭且抽象層厚；stateless JWT 在 token 到期前無法撤銷。

### 決策

採**自建 DB-backed opaque session**（參考 Lucia 模式）：
登入 → 產生 256-bit random token → DB `sessions` 表存 `sha256(token)` → 原始 token 放 HttpOnly cookie；
每請求以 hash 查表取 user，Next.js 內以 `cache()` 包裝 per-request 解析避免重複查詢。
**不用 JWT。** OIDC 用 `openid-client`（certified library）以 `IdentityProvider` 介面預留——OIDC 只負責「驗明身分」，session 管理仍是自家的。

### 取捨與後果

- **得**：即時撤銷——停用帳號時刪除 sessions 列即全面登出，JWT 做不到（除非引入黑名單，等同又回到 stateful）。
- **得**：session 存 DB 正好滿足 web 層 stateless，K8s 多副本共用無黏著；每個 session 有 ip/user_agent/last_active_at，直接支撐 audit 與「裝置管理」。
- **得**：自建約數百行、完全掌控，無框架升級綁架；加 OIDC 不動任何授權邏輯（同一張 `users` 表、同一套 session）。
- **失**：每請求多一次 DB 查詢——內網規模下毫無壓力；未來若量大可加 in-memory TTL cache（犧牲撤銷即時性數秒）。
- **失**：自建需自行做對 token 熵值、hash 儲存、cookie 屬性（HttpOnly/Secure/SameSite）、登入失敗遞增延遲——已在 NFR-SEC-02/03 明文規範並列入驗收。

---

## ADR-005：Embedding day-1 採 local BGE-M3（1024 維）

- **狀態**：已接受
- **日期**：2026-07-06
- **對應審查編號**：G4／R3

### 背景

RAG 需要 embedding。候選：Voyage AI（`voyage-3.5` 系列，品質頂級但資料出外網、按量計費）vs 自架 local BGE-M3（MIT，1024 維，中文表現優異，透過 OpenAI-compatible endpoint 供應）。
兩個關鍵事實：（1）合規要求「內部資料不外流」（NFR-COMP），而**文件全文送 embedding API 的外流面比問答更大**；
（2）chat 模型切換零成本，但 **embedding 換模型的代價是全庫重嵌**——若維度改變（pgvector 欄位維度固定），更是 DDL migration 而非跑個 job（G4）。

### 決策

**Embedding 自 day-1 即採 local BGE-M3（1024 維）**，透過 OpenAI-compatible embedding endpoint（Ollama/vLLM/TEI）供應，介面與後期 Local LLM 階段完全一致。
`page_embeddings.embedding` 定為 `vector(1024)` ＋ HNSW（`vector_cosine_ops`），`embedding_model` 欄位記錄模型名。
**維度變更＝四步 migration 流程**（文件化為唯一合法路徑，G4）：
1. migration 建新欄/新表（新維度）；
2. 背景 `reindex-all` job 全量重嵌（批次＋斷點續跑＋進度回報，F-ADMIN-04 UI 承接）；
3. 檢索切換至新欄；
4. 清理舊欄與舊索引。

### 取捨與後果

- **得**：day-1 即符合資料不外流，先堵住合規上最大的洞；後期切 Local LLM 時 embedding 端**零遷移**（免一次全庫重嵌）。
- **得**：BGE-M3 在中文語料表現優異，量小時 CPU 亦可跑。
- **失**：把「自架推論服務」提前為 Phase 2 硬依賴，有維運負擔；極限品質略遜於商用頂級模型（R3）。
- **降險（R3）**：建 30–50 題繁中 golden question 檢索評測集，任何 embedding/分詞/chunking 變更都跑一次；預先評估推論硬體（無 GPU 時的 CPU 吞吐）；若初期自架確不可行，備案為 Voyage 起步＋保留 `reindex-all` 遷移路徑，並依 NFR-COMP-02 揭露外呼盤點。
- **降險（R4，關聯）**：pgvector ≥ 0.8 啟用 iterative index scan、檢索 over-fetch（k=40 再過濾）、必要時評估 `halfvec`。

---

## ADR-006：v1 併發控制採軟性編輯鎖＋樂觀版本檢查，CRDT/Yjs 留 v2

- **狀態**：已接受
- **日期**：2026-07-06
- **對應審查編號**：C1／R5

### 背景

審查發現三份設計文件對編輯併發模型有三種說法（C1，本輪審查最重要發現）：需求文件寫編輯鎖、架構文件只有 autosave 無鎖、UI 文件畫了純樂觀衝突攔截 modal。
即時共編（CRDT/Yjs）已明列 v1 Won't。內部團隊規模下，同頁同時編輯是低頻事件，但一旦發生的「靜默覆蓋」不可接受。

### 決策

v1 採**兩道防線**（以需求文件為準，三份文件已對齊）：

1. **軟性編輯鎖（主防線）**：`pages.locked_by` ＋ `pages.locked_at` 兩欄；**心跳續租 30s、閒置 5 分鐘釋放**（＝容忍連續 10 次心跳遺失）、**Admin 可搶鎖**（takeover 寫 audit `lock.takeover`，原持鎖人下次心跳收 `LOCK_LOST` 降唯讀並保留未存內容供複製）。取鎖為**單條原子 UPDATE**（`WHERE locked_by IS NULL OR locked_by = :me OR locked_at < now() - interval '5 minutes'`），過期判定內建於取鎖條件，**不需背景程序釋放鎖**。
2. **樂觀版本檢查（備援）**：`savePage` 必帶 `baseVersionNo`，與 `pages.current_version_no` 不符即回 409 CONFLICT，前端顯示衝突攔截畫面（檢視差異／仍要覆蓋／複製我的內容）——這是鎖失效（如搶鎖後殘留分頁強行送出）時的最後防線。`savePage` 第一步並驗證 `locked_by = 呼叫者`，防止繞過前端直呼 action。

CRDT/Yjs 即時共編留待 v2（ADR-002 的 ProseMirror JSON canonical 已為此鋪路）。

### 取捨與後果

- **得**：實作成本遠低於 CRDT（兩個欄位＋三個 actions），卻同時消除「同時編輯」與「靜默覆蓋」兩種失敗模式；鎖過期靠取鎖條件自癒，無背景清理的失效風險。
- **失**：同一時間僅一人可編輯同一頁——對內部知識庫是可接受的體驗（他人開啟時見唯讀＋「某某編輯中」banner）；心跳為每 30s 一次的輕量寫入。
- **邊界**：釋放鎖（主動或逾時）即結束一次「編輯 session」，下次取鎖後的第一個 autosave 一律新開版本快照，不與前人合併（與 ADR-008 銜接）。
- **驗收（R5）**：併發設計短文（狀態機＋時序圖）已入架構文件 B.3；「雙人同時編輯」為 Playwright E2E 必測情境（唯讀 banner／5 分鐘後接手／搶鎖後 409 攔截），納入 NFR-MAINT-01。

---

## ADR-007：中文全文檢索選型待 M0 spike 定案（傾向 pgroonga），interface 先以 tsvector 抽象

- **狀態**：已接受（暫定——M0 spike 後定案並更新本則）
- **日期**：2026-07-06
- **對應審查編號**：R2／C12

### 背景

PostgreSQL 內建 text search parser 不支援中文斷詞，繁中全文檢索必須外掛 extension。候選：
- **zhparser**：基於 SCWS 詞庫斷詞，輕量、與 tsvector 生態直接相容；但詞庫以簡體中文為主，zh-TW 斷詞品質（含公司專有名詞如「捷揚光電」、料號、中英混排）未經驗證（R2）。
- **pgroonga**：n-gram 為主，對繁中魯棒、免詞庫維護；代價是自建 DB image 較重（LGPL，內部部署無散布義務）。

審查另發現文件間出現過 pg_jieba 的殘留說法（C12），已統一為上述二選一。此選型「有品質陷阱且未定案」被評為高風險（R2）。

### 決策

**選型由 M0 spike 定案**（1–2 天）：以 50–100 份真實公司文件＋ 20 條驗收查詢（含「捷揚光電→捷揚」、料號、中英混排）比較 zhparser（＋自訂繁中詞庫）vs pgroonga，**審查傾向 pgroonga 作為 zh-TW 預設**。
在定案前，程式介面**先以 tsvector 抽象**：schema 保留 `pages.search_tsv`（tsvector, GIN index）與搜尋 lib 的單一查詢入口，
兩候選皆可掛入（zhparser 直接產 tsvector；pgroonga 則以自有 index 替換該查詢路徑），
確保 M0 定案時只改 DB image 與該查詢入口，不動呼叫端。

### 取捨與後果

- **得**：把「斷詞品質」這個無法紙上推演的問題交給真實語料實測，避免上線後才發現搜尋不準的返工（重建全文索引＋換 extension）。
- **得**：介面先抽象，spike 兩種結局的切換成本都被限制在單點。
- **失**：M0 需自建含 extension 的 PG image 兩套供比較；選 pgroonga 的話 DB image 永久較重。
- **後續**：定案後更新本 ADR 狀態與 `docs/architecture/system-architecture.md` B.9 選型表，並將勝出方的驗收查詢集納入 CI 回歸（與 ADR-005 的 golden question 評測集並行維護）。

---

## ADR-008：版本歷史存完整 JSON 快照（非 delta），diff 顯示時計算

- **狀態**：已接受
- **日期**：2026-07-06

### 背景

F-VER 要求自動版本快照、檢視、還原（Must）與版本 diff（Should）。儲存策略候選：完整快照 vs delta 鏈（僅存差異）。
規模預估：文件 JSON 平均數十 KB，10 萬頁 × 每頁約 50 版。

### 決策

每次「顯性存檔」與「autosave 靜止 5 分鐘後的合併點」寫入一筆 `page_versions` **完整 JSON 快照**（content jsonb ＋ content_md ＋ title），**不用 delta**。
**Diff 在顯示時計算**：以兩版 `content_md` 做文字 diff（`diff` npm 套件，中文採字詞級 diff）呈現，未來可升級為 ProseMirror 節點級 diff。

### 取捨與後果

- **得**：實作簡單、還原 O(1)（直接以快照覆寫）、任一版本獨立可讀——不會因 delta 鏈中任一環損壞而喪失其後所有歷史。
- **得**：diff 不落地，儲存端零額外複雜度；換 diff 演算法（文字級→節點級）不需資料遷移。
- **失**：儲存空間較 delta 大——估算 10 萬頁 × 50 版在數百 GB 內可控，且 jsonb TOAST 自動壓縮；如未來超出預期，可對高齡版本做冷歸檔或保留策略，屬營運調整而非架構變更。
- **失**：顯示 diff 需即時計算兩版差異——單頁數十 KB 的文字 diff 為毫秒級，可接受。
- **邊界**：版本快照的 session 邊界跟隨編輯鎖（ADR-006）：釋放鎖即結束一次編輯 session，下次取鎖後首個 autosave 新開快照。

---

## ADR-009：LLM Provider 抽象層不暴露 sampling 參數，模型以 `tier: primary | light` 抽象

- **狀態**：已接受
- **日期**：2026-07-06
- **對應審查編號**：C6

### 背景

LLM 需前期 Anthropic API（`claude-sonnet-5` 主力、`claude-haiku-4-5` 輕量）→ 後期 OpenAI-compatible（Ollama/vLLM）以 env 切換。
關鍵事實：`claude-sonnet-5` **不接受非預設 `temperature`/`top_p`/`top_k`**（送了會 400，已驗證屬實）。
審查並發現 UI 文件曾把 AI 設定頁畫成可編輯表單（含 temperature 輸入欄），與 12-factor 的「provider 切換僅透過環境變數」及上述 API 行為直接衝突（C6）。

### 決策

`LLMProvider` 介面（`src/lib/llm/provider.ts`）**刻意不暴露任何 sampling 參數**（無 temperature/top_p/top_k），輸出風格一律靠 prompt 控制；
模型選擇以 **`tier: 'primary' | 'light'`** 抽象（而非寫死模型名），各 provider 實作內部以環境變數映射到具體模型 ID（`ANTHROPIC_MODEL_PRIMARY`、`OPENAI_COMPAT_MODEL_LIGHT` 等）。
Provider 專屬參數（如 Anthropic 的 `output_config: { effort: 'low' }`）封裝在各實作內，不進抽象介面。
對應地（C6），管理後台 AI 設定頁為**唯讀**健康檢查頁（顯示 provider/模型/遮罩後 key 末四碼＋測試連線），無 temperature/max tokens 等輸入欄；「重建索引」「功能開關」「quota」屬 DB 儲存的營運設定，不在此限。

### 取捨與後果

- **得**：介面在 Anthropic 與 OpenAI-compatible 之間可完全互換——不存在「某參數只有一邊支援」的洩漏抽象；切換 provider 是純 env 變更，零程式碼修改。
- **得**：杜絕一整類 400 錯誤（對 claude-sonnet-5 送 sampling 參數）；呼叫端也不必理解各模型的參數相容矩陣。
- **失**：無法針對個別任務微調 sampling——接受此限制，因輸出品質靠 prompt 與 tier 選擇控制即已足夠；若某 local 模型確需特定參數，在該 provider 實作內以 env 設定，仍不進介面。
- **失**：`tier` 二級制（primary/light）粒度較粗——目前任務分工（問答生成 vs query rewrite/標題生成）恰為兩級，未來需要時擴充 enum 即可，屬向後相容變更。

---

## ADR-010：v1 採直接編輯＋autosave，無草稿/發布閘門

- **狀態**：已接受
- **日期**：2026-07-06
- **對應審查編號**：C2

### 背景

審查發現「草稿/發布」工作流只存在於 UI 文件（發布按鈕、我的草稿側欄、僅發布版篩選），需求與資料模型皆無支撐（C2）：
`pages` 無 `status`/`published_version_no` 欄位，F-PAGE-02/F-VER-01 定義的是「直接編輯＋自動儲存＋自動版本快照」。
二者只能擇一：補齊發布閘門的全套需求/schema/UI，或刪除 UI 的發布假設。

### 決策

**v1 採「直接編輯＋autosave＋自動版本快照」，無草稿/發布閘門**（採需求文件模型，成本最低）。
UI 移除發布按鈕、草稿側欄、「僅發布版」篩選；`pages` 表**刻意不設** `status`/`published_version_no` 欄位。
防誤改由兩機制承接：版本快照隨時可還原（ADR-008）＋編輯鎖防併發（ADR-006）。
**後果之一必須明示：RAG 索引的是即時內容**——存檔即觸發 embedding job，知識問答反映最新狀態，不存在「僅索引已發布版」的隔離。

### 取捨與後果

- **得**：省去整套發布狀態機（status 欄位、發布 action、草稿可見性規則、雙版本渲染），v1 範圍風險（R1）直接受益；「所見即最新」也符合內部 wiki 的使用直覺。
- **得**：autosave ＋自動快照讓「未儲存遺失」與「誤改無法回復」兩種失敗模式都被涵蓋。
- **失**：半成品內容立即可見、立即進搜尋與 RAG——內部信任環境可接受；作者可用 space/頁面權限（private space、restricted page）作為事實上的草稿區。
- **失**：若未來需要「審核後才發布」的治理流程（如對外文件），須以新 ADR 引入 `pages.status` ＋ `published_version_no` 並回補 UI——schema 屆時為加欄位的向前遷移，不需破壞性變更；v1.x 的「變更請求」（F-COLLAB Should，M4）是該方向的第一步。
- **關聯**：離線編輯同屬 v1 Won't（C7）——連線中斷僅「提示＋編輯器記憶體保留＋自動重試儲存」，不承諾本機持久化。
