# JetBook 完整性審查報告（含決議狀態）

- 文件版本：v1.1（規劃落地版）
- 內容：第一節為 28 項發現（C1–C12 衝突、G1–G11 缺漏、R1–R6 風險）的**決議狀態總表**；第二節起為審查報告全文（原樣保留，供追溯審查當下的判斷依據）。
- 閱讀指引：全文中與決議狀態表衝突之處（例如 C1/C2 的「建議」段落），以決議狀態表為準。

---

## 決議狀態總表

| 編號 | 嚴重度 | 主題 | 決議狀態 |
|---|---|---|---|
| C1 | 高 | 編輯併發模型三種說法 | **已拍板（使用者決策）**：採軟性編輯鎖——`pages.locked_by`/`locked_at`、心跳續租 30s、閒置 5 分鐘自動釋放、Admin 可搶鎖；`current_version_no` 樂觀版本檢查為第二道防線。鎖欄位併入 C-02 schema，實作於 D-09 |
| C2 | 高 | 草稿/發布工作流只存在於 UI | **已拍板（使用者決策）**：v1 採「直接編輯＋autosave＋自動版本快照」，無草稿/發布閘門；UI 已移除發布按鈕、變更摘要 popover、「我的草稿」側欄、草稿 badge、「僅發布版」篩選（已於 v1.1 文件套用） |
| C3 | 中 | Space 角色缺 commenter | 已於 v1.1 文件套用（權限矩陣四級）；schema 併入 C-01「schema 一次補齊」 |
| C4 | 中 | visibility 二態 vs 三態 | 已於 v1.1 文件套用：定為三態 `private / org_read / org_write`；schema 併入 C-01「schema 一次補齊」 |
| C5 | 中 | 群組 UI 有、schema 無 | 已納入 issue 範圍：B-01 建 `groups`/`group_members` 表、C-01 授權主體泛化 `user\|group`、K-03 實作授權解析與管理 UI |
| C6 | 中 | AI 設定頁可編輯 vs 唯讀 12-factor | 已於 v1.1 文件套用（UI 規格 §3.11 改唯讀＋刪除 temperature/max tokens 欄位）；L-03 已補「AI 設定唯讀化」說明 |
| C7 | 中 | 離線編輯承諾違反 Won't | 已於 v1.1 文件套用：降級為「連線中斷提示＋編輯器記憶體保留＋自動重試儲存」，不承諾本機持久化 |
| C8 | 中 | 稽核與備份優先級矛盾 | 已於 v1.1 文件套用：兩者升為 Must/P0；對應 B-07（稽核寫入）、N-03（備份）均排入 M1 |
| C9 | 低 | ORM 選型殘留 Prisma | 已於 v1.1 文件套用：統一 Drizzle（A-04），檔案路徑改 `src/lib/db/schema.ts` + `drizzle/` |
| C10 | 低 | 效能目標數字三處不同 | 已於 v1.1 文件套用：以 NFR 表為唯一來源（typeahead P95 200ms、AI TTFT P95 4s、索引 P95 60s） |
| C11 | 低 | 編輯器細節錯位（標題層級/TOC/⌘K） | 已於 v1.1 文件套用：標題統一 H1–H3；TOC 取 H2/H3；slash 選單依 F-EDIT 優先級重排；「編輯模式且有文字選取時 ⌘K=插入連結，否則=全域搜尋」 |
| C12 | 低 | 垃圾桶入口/AI 介面/分詞名稱/統計數字 | 已於 v1.1 文件套用：AI 介面以抽屜為主；分詞候選統一 zhparser vs pgroonga（見 R2）；統計重算 **Must 40 / Should 27 / Could 16 / Won't 7（共 90）** |
| G1 | 高 | Slug 301 無資料模型 | 已納入 issue 範圍：`page_slug_history` 併入 C-02「schema 一次補齊」，路由 resolver 與寫入實作於 C-05 |
| G2 | 高 | Markdown 匯入缺 UI 與流程 | 已納入 issue 範圍：J-01（轉換器＋單檔）、J-02（zip 批次匯入 job，含 zip bomb 上限、路徑穿越檢查、單檔大小限制）；匯入精靈 wireframe 已於 v1.1 UI 文件補畫 |
| G3 | 中 | AI 對話/配額/回饋資料模型缺失 | 已納入 issue 範圍：`ai_usage`（I-06）、`ai_conversations`/`ai_messages` 含 chunk 引用快照（I-07）；回饋表列 M4 backlog（F-AI-12） |
| G4 | 中 | Embedding 維度寫死 vs 換模型 | 已於 v1.1 文件套用：H-07 reindex 設計納入「維度變更＝migration（新欄/新表）→ 全量重嵌 → 切換 → 清理」四步流程；day-1 以 BGE-M3 1024 維起步 |
| G5 | 中 | Broken link 檢查缺席 | 已納入 issue 範圍：**新增 C-13**（死鏈標示與回收桶還原入口，M3）；背景死鏈報表列 M4 backlog（F-ADMIN-06） |
| G6 | 中 | 附件治理缺失（孤兒回收/用量/歸屬） | 已納入 issue 範圍：**新增 M-03**（孤兒附件 GC job＋儲存用量統計，M3）；C-10 驗收已含跨 space 移動時附件 space 歸屬轉移 |
| G7 | 中 | 五個 Must 功能沒有 UI 設計 | 已於 v1.1 文件套用（忘記密碼/邀請首登/個人設定/完整搜尋結果頁/通知中心五張 wireframe 補畫；SMTP 列 P0 基礎設施）；個人設定頁已納入 issue 範圍（**新增 B-08**，M1） |
| G8 | 中 | UI 畫了但規格與 schema 皆無的功能群 | 已於 v1.1 文件套用：砍出 v1——標籤、公告、頁面回饋、側欄隱藏；保留釘選——`space_pinned_pages` 併入 C-01「schema 一次補齊」；申請權限複用 notifications |
| G9 | 低 | 「最近瀏覽」無資料來源 | 已納入 issue 範圍：`page_visits` 併入 C-02「schema 一次補齊」，讀寫實作於 C-06 |
| G10 | 低 | Collections 無 schema 預留；變更請求無預留 | 已納入 issue 範圍：`collections` 表與 `spaces.collection_id` 併入 C-01「schema 一次補齊」，功能實作於 C-09；變更請求預留設計寫入架構文件，功能列 M4 backlog |
| G11 | 低 | 排程清理 job 未列 worker 職責 | 已於 v1.1 文件套用（worker 職責補 cron jobs 一類，pg-boss 原生 cron）；清除排程已納入 issue 範圍（C-08 回收桶 30 天、C-12 Space 軟刪逾期、M-03 附件 GC） |
| R1 | 高 | v1 範圍過大（Must 實為 40 項） | 已於 v1.1 文件套用：統計重算；編輯器一律採現成 TipTap extensions 零自研；UI 元素標註 F-編號與 phase；v1 驗收＝最短鏈路（登入→編輯→搜尋→RAG→管人） |
| R2 | 高 | 繁中全文檢索選型未定 | 已納入 issue 範圍：A-10（M0 spike，50–100 份真實文件＋20 條驗收查詢，zhparser vs pgroonga，審查傾向 pgroonga），產出 ADR 定案後同步文件 |
| R3 | 中 | 中文 embedding 品質＋自架推論負擔 | 已於 v1.1 文件套用：30–50 題 golden question 檢索評測集納入 RAG 驗收要求（I-01/N-04 執行）；重嵌 job 設計為批次＋斷點續跑＋進度回報（H-07）；備案 Voyage 起步＋reindex 遷移路徑 |
| R4 | 中 | pgvector 規模與權限過濾×HNSW 召回 | 已於 v1.1 文件套用：要求 pgvector ≥ 0.8＋iterative index scan、檢索 over-fetch（k=40 取 20）、`hnsw.ef_search` 調校；I-01 為實作點，基準測試納入 NFR-PERF-03 驗收 |
| R5 | 中 | 編輯鎖設計密度不足 | 已納入 issue 範圍：D-09 描述已對齊軟鎖決策（心跳 30s/閒置 5 分/Admin 搶鎖，含狀態機設計）；「雙人同時編輯」列入 N-02 Playwright E2E 必測情境 |
| R6 | 低 | 引用跳轉錨點脆弱（heading_path） | 已於 v1.1 文件套用：TipTap heading/block 節點加持久 `id` attribute，`page_embeddings` 記 block id 而非文字路徑（D-01/H-05 錨點規則） |

---

# 審查報告全文（原文照錄）

# JetBook 三份設計文件 — 完整性與一致性審查報告

審查範圍：功能需求規格（Doc 1）、NFR 與系統架構（Doc 2）、UI/UX 設計規格（Doc 3）。附註：Doc 2 中的 Anthropic 模型宣稱已對照最新 API 資料驗證，`claude-sonnet-5`（1M context、$3/$15、2026-08-31 前 $2/$10 優惠、拒絕非預設 temperature/top_p/top_k、省略 thinking 即 adaptive）與 `claude-haiku-4-5`（200K、$1/$5）皆正確，B.8 設計無需修改。

---

## 一、衝突（Conflicts）

### C1.【高】編輯併發模型三份文件三種說法（本次審查最重要發現）
- Doc 1 F-COLLAB-01（Must）：**編輯鎖**（同時僅一人編輯＋心跳逾時＋樂觀版本檢查）。
- Doc 2：只有 autosave＋版本快照，**資料模型完全沒有鎖**（無 page_locks 表、pages 無 locked_by/locked_at），B.5 的 `savePage` 也未提鎖檢查。
- Doc 3 §3.5：**發布時衝突攔截 modal**（「內容已被 X 更新 → 檢視差異/仍要覆蓋/另存草稿」），是純樂觀併發模型，無鎖定 UI（無「某某編輯中」指示、無唯讀降級）。
- **建議（v1 明確採鎖，CRDT 留 v2）**：以 Doc 1 為準——軟性編輯鎖（DB 記 locked_by/locked_at，心跳續租 30s、閒置 5 分鐘釋放、Admin 可搶鎖）＋ `current_version_no` 樂觀檢查為第二道防線。需要的修正：Doc 2 補鎖欄位與 `acquireLock/heartbeat/releaseLock` actions；Doc 3 補「鎖定中」banner、唯讀檢視、搶鎖確認等 UI 狀態，並將發布攔截 modal 降為樂觀檢查失敗時的備援畫面。

### C2.【高】草稿/發布（Draft/Publish)工作流只存在於 UI
Doc 3 大量假設發布閘門：`⌘Enter 發布`、變更摘要 popover、「我的草稿」側欄、頁面樹草稿 badge、版本歷史「僅發布版」篩選、「儲存草稿」。但 Doc 1 的模型是「直接編輯＋自動儲存＋自動版本快照」（F-PAGE-02、F-VER-01），Doc 2 的 `pages` 無 status/published 欄位、`page_versions` 無 published 標記。
- **建議**：v1 採「直接編輯＋autosave」（成本最低、與 F-VER-01 一致），刪除 Doc 3 的發布按鈕/草稿側欄/僅發布版篩選；若團隊堅持發布閘門（好處：RAG 只索引已發布內容），則必須回頭補 Doc 1 需求項與 Doc 2 的 `pages.status`、`published_version_no` 欄位。二擇一，不能維持現狀。

### C3.【中】Space 角色 enum 不一致
Doc 1/Doc 3 都有 **Commenter**（admin/editor/commenter/viewer 四級），Doc 2 的 `space_members.role` 與 NFR-SEC-04 只有三級（admin/editor/viewer）。
- **建議**：Doc 2 schema 與 `permission.ts` 補 `commenter`（可讀＋可留言，隨 F-COLLAB-02 啟用），權限矩陣文件化四級能力。

### C4.【中】Space 可見性狀態數不一致
Doc 2：`visibility` 二態（`org` 全員可讀 | `private`）。Doc 3 §3.10：三態 radio（私人／內部公開可讀／**內部公開且可編輯**）。
- **建議**：schema 改為 `private | org_read | org_write`（或砍掉 UI 第三態）。權限解析順序需同步更新。

### C5.【中】使用者群組（Teams）UI 已畫、schema 不存在
Doc 1 F-SEC-06（Should）＋ Doc 3（成員表格「來源：經由群組」badge、群組掛載區、管理後台群組管理）都假設群組，但 Doc 2 無 `groups`/`group_members` 表，且 `space_members` 只收 user_id、`page_permissions.subject_type` 只有 `user|space_role`，無 `group`。
- **建議**：Doc 2 補兩張表並將授權主體泛化為 `user|group`；`getAccessiblePageIds` 的 SQL 需 join 群組成員。此為 AD/SSO 群組映射的前置，宜在 Phase 1 schema 就預留。

### C6.【中】AI 設定頁：可編輯表單 vs 唯讀 12-factor
Doc 1 F-ADMIN-03 明定後台為「**唯讀**設定健康檢查頁」、Doc 2 NFR-MAINT-05/NFR-COMP-01 規定 provider 切換**只透過環境變數**；Doc 3 §3.11 卻設計了可編輯的 provider 下拉、API Key 輸入欄、Base URL、模型名稱表單——還包含 **temperature 欄位**，而 Doc 2 B.8 已明確指出抽象層不暴露 sampling 參數（claude-sonnet-5 送 temperature 會 400，此點已驗證屬實）。
- **建議**：§3.11 改為唯讀顯示（provider/模型/遮罩後 key 末四碼）＋[測試連線] 按鈕；刪除 temperature/max tokens 輸入欄；「重建索引」「功能開關」「quota」可保留為 DB 儲存的營運設定（這些不屬於 12-factor 環境設定）。

### C7.【中】離線編輯承諾違反 Won't 清單
Doc 3 有「離線，變更暫存於本機」狀態與「網路中斷→暫存本機→恢復自動同步」banner；Doc 1 第 14 節明列「離線存取」為 Won't，且本機持久化＋重連同步＋衝突合併是不小的工程，Doc 2 無任何支撐。
- **建議**：降級為「連線中斷提示＋編輯器記憶體保留＋自動重試儲存」，不承諾本機持久化；文案改為「網路連線中斷，請勿關閉分頁」。

### C8.【中】優先級矛盾：稽核與備份
- 稽核：Doc 1 F-SEC-07 = **Should**；Doc 2 NFR-SEC-06 = **P0**（出貨門檻、append-only、保留 1 年，且 AI 查詢也要留審計）。
- 備份：Doc 1 F-IE-05 = **Should**；Doc 2 NFR-DATA-01~03 = **P0**（RPO 1h/RTO 4h/異機保存）。
- **建議**：兩者皆以 NFR 為準升為 Must/P0（實作成本低、風險高，不該延後）；Doc 1 總覽表同步修正。

### C9.【低】ORM 選型殘留不一致
Doc 1 關鍵檔案列 `prisma/schema.prisma`，Doc 2 選型為 **Drizzle**（理由充分：pgvector/tsvector/recursive CTE/SKIP LOCKED）。
- **建議**：統一 Drizzle，Doc 1 檔案路徑改為 `src/lib/db/schema.ts` + `drizzle/`。

### C10.【低】效能目標數字三處不同
搜尋即時結果：150ms（Doc 3）/ 200ms typeahead（Doc 2）/ 300ms（Doc 1）；AI 首 token：3s（Doc 1）/ 4s P95（Doc 2）；嵌入可檢索延遲：5 分鐘（Doc 1）/ 60s P95（Doc 2）。
- **建議**：以 Doc 2 NFR 表為唯一來源（typeahead P95 200ms、TTFT P95 4s、索引 P95 60s），Doc 1/Doc 3 改為引用。

### C11.【低】編輯器細節多處錯位
- 標題層級：Doc 1 F-EDIT-03 = H1–H3；Doc 3 = `⌘⌥1~4`（H1–H4）且 slash 選單含 H4。
- TOC：Doc 1 依 H1–H3；Doc 3 §2.1 只取 H2/H3。
- Slash 選單：Doc 3 缺 Mermaid（Should）與 Tabs/摺疊/步驟（Should），卻收了數學式（Could）。
- `⌘K`：Doc 3 定為全域搜尋，但 Doc 1 F-EDIT-03 用 Cmd+K 插入超連結（業界慣例）。
- **建議**：統一 H1–H3；TOC 取 H2/H3（頁標題即 H1）；slash 選單依 F-EDIT 優先級重排；定義「編輯模式且有文字選取時 ⌘K=插入連結，否則=全域搜尋」。

### C12.【低】其他小錯位
- 垃圾桶：Doc 1 為 Space 層級；Doc 3 在全域側欄與 space 側欄各有一個入口 → 定義全域入口為「跨 space 彙整檢視」或移除。
- AI 介面：Doc 2 有 `ask/page.tsx` 獨立頁 vs Doc 3 右側抽屜（⌘J）→ 以抽屜為主，/ask 作為深連結全螢幕檢視或刪除。
- 中文分詞：Doc 3 §6.9 寫「zhparser/pg_jieba」與 Doc 2 B.9「zhparser/pgroonga」不一致 → 統一（見 R2）。
- 統計數字：Doc 1 尾註「Must 34、Should 25、Could 15、Won't 8（共 82）」與其總覽表實際數量不符——重算為 **Must 40、Should 27、Could 16、Won't 7（共 90）**。修正數字，這也放大了 R1 的範圍風險。

---

## 二、缺漏（Gaps）

### G1.【高】Slug 301 導向無資料模型支撐
F-PAGE-03（Must）要求「舊 slug 永久導向、內部引用不失效」，但 Doc 2 schema 無 slug 歷史表。
- **建議**：補 `page_slug_history(space_id, old_slug, page_id, created_at)`，改名時寫入；路由 resolver 先查現行 slug 再 fallback 查歷史表回 301。跨 space 移動（F-PAGE-05）也依賴此表。

### G2.【高】Markdown 匯入（Must）缺 UI 與架構流程
初期內容搬遷的關鍵路徑，但 Doc 3 無匯入精靈畫面，Doc 2 worker job 清單只有「匯出」沒有「匯入」。
- **建議**：補（1）UI：上傳 zip → 結構預覽（對應頁面樹）→ 進度 → 成功/失敗報告；（2）`import-markdown` job handler（md→TipTap JSON 轉換、圖片改寫上傳）；（3）安全：zip bomb 上限、路徑穿越檢查、單檔大小限制。

### G3.【中】AI 對話／配額／回饋資料模型缺失
F-AI-07（對話歷史）、F-AI-11（每人每日配額）、F-AI-12（回答回饋＋chunk 快照）在 Doc 2 ERD 完全沒有對應表。
- **建議**：補 `ai_conversations`、`ai_messages`（含檢索到的 chunk 引用快照，供稽核與回饋分析）、`ai_usage`（per user/day 計數，配額強制執行點在 route handler）。

### G4.【中】Embedding 維度寫死 vs 換模型需求
Doc 2 定 `embedding vector(1024)`（HNSW），但 F-AI-02 要求可換 provider/模型；pgvector 欄位維度固定，換成 1536 維模型（如 OpenAI 系）需要 DDL migration＋重建索引，不只是「跑 reindex job」。
- **建議**：在 `reindex-all` 設計中明確納入「維度變更 = migration（新欄/新表）→ 全量重嵌 → 切換 → 清理」四步流程；或約定僅支援 1024 維模型族（bge-m3、voyage-3.5 可配置 1024）並文件化此限制。

### G5.【中】Broken link 檢查完全缺席（指定檢查項）
F-EDIT-12 以 pageId 連結緩解「改名」，但「刪除頁面」後的行內連結、以及外部 URL 失效，三份文件皆未處理。
- **建議**：v1 最低限度——渲染內部連結時偵測目標已刪除，顯示「已刪除頁面」樣式 chip（可連到回收桶還原）；v1.x——背景掃描 job 產出死鏈報表（進 F-ADMIN-06 內容分析），外部 URL 檢查列 Could。

### G6.【中】附件治理缺失（指定檢查項）
上傳/下載/權限/掃描都有，但缺：孤兒附件回收（頁面刪除或內容中移除引用後 attachments 永久殘留）、Space 層級附件管理視圖、儲存用量統計、以及跨 space 移動頁面時 `attachments.space_id` 的同步更新規則（否則附件權限判斷會跟錯 space）。
- **建議**：補「內容引用計數＋30 天寬限的 GC job」、admin 儲存用量卡片；在 F-PAGE-05 驗收標準中明列附件 space 歸屬轉移。

### G7.【中】多個 Must 功能沒有 UI 設計
忘記密碼／Email 重設流程（F-SEC-01 Must）、邀請使用者首次登入設密碼（F-ADMIN-01 Must）、個人設定頁（密碼變更、深色模式持久化、通知偏好——Doc 3 多處引用「個人設定」但無畫面）、完整搜尋結果頁（Cmd+K「顯示全部 N 筆」的目的地，需承載 F-SEARCH-03 過濾器）、通知中心面板（鈴鐺已是頂欄常駐元件）。
- **建議**：Doc 3 補這五張 wireframe；忘記密碼流程連帶要求 SMTP 為 P0 基礎設施（目前 Email 通知被列 Could，但密碼重設 Must 依賴寄信——compose 與 env 清單需含 SMTP）。

### G8.【中】UI 畫了但規格與資料模型皆無的功能群
頁面標籤（§3.5 編輯資訊欄）、Space 釘選頁面（§3.3，最多 6 張）＋空間列表星號釘選、Dashboard 公告區、頁尾「這頁有幫助嗎 👍👎」、頁面「在側欄隱藏」設定、403 頁「向管理員申請權限」通知。
- **建議**：逐項二擇一——砍出 v1（建議砍：標籤、公告、頁面回饋、側欄隱藏）或補 F-編號＋schema（建議補：釘選——一個 `space_pinned_pages` 小表即可；申請權限——複用 notifications）。

### G9.【低】「最近瀏覽」無資料來源
Dashboard「繼續閱讀」與 Cmd+K 空狀態都用最近瀏覽，schema 無 page_visits。
- **建議**：補 `page_visits(user_id, page_id, visited_at)`（upsert、每人保留 N 筆），或明定 v1 用 localStorage（代價：不跨裝置）。

### G10.【低】Collections（Should）無 schema 預留；變更請求（Should、v1.x 首要）無資料模型與 UI 預留
- **建議**：schema 預留 `collections` 表與 `spaces.collection_id`；變更請求至少寫一段預留設計（草稿分支存 `page_versions` 加 `branch_id`，或獨立 `change_requests` 表），避免 v1.x 推翻版本模型。

### G11.【低】排程清理 job 未列入 worker 職責
30 天回收桶清除（F-PAGE-06）、軟刪 Space 逾期清除（F-ORG-04）、過期 session 清理、audit 月分區維護。
- **建議**：B.1/B.10 的 worker 職責清單補「cron jobs」一類（pg-boss 原生支援 cron）。

### 指定檢查項中「無缺漏」的確認
- **RAG 權限過濾**：三份一致且 Doc 2 做法正確（SQL join 檢索前過濾、非事後過濾、NFR-SEC-05 列出貨門檻＋專屬整合測試、排除 ai_indexing_enabled=false）。僅殘留技術風險見 R4。
- **備份還原演練**：NFR-DATA-01~04 完整（每日全備＋WAL、異機、季度演練），僅優先級矛盾見 C8；小提醒：DB dump 與附件 volume 備份的時間點不一致視窗需在 runbook 中聲明可接受範圍。

---

## 三、風險（Risks）與降險建議

### R1.【高】v1 範圍過大——實際 Must 是 40 項，不是 34 項
編輯器一項就佔 11 個 Must（表格、程式碼高亮 20 語言、圖片、附件、markdown 貼上含表格轉換……），加上 Doc 3 又把多個 Should/Could（評論側欄、行內評論、通知鈴鐺、AI 寫作輔助選單、公告、釘選）畫成核心 shell。
- **降險**：（1）修正統計並重審 Must 清單——建議將 F-EDIT-07 表格、F-EDIT-10 附件降為「v1 內部第二批」；markdown 貼上的表格轉換降 Should。（2）編輯器一律採現成 TipTap extensions（table、code-block-lowlight、task-list 等）零自研。（3）Doc 3 為每個畫面元素標註對應 F-編號與 phase，超規格元素預設不進 v1。（4）明確定義 v1 驗收 = Doc 1 §0 的最短鏈路（登入→編輯→搜尋→RAG 問答→管人）。

### R2.【高】繁體中文全文檢索選型未定且有品質陷阱
zhparser 基於 SCWS，詞庫以簡體中文為主，zh-TW 斷詞品質（含公司專有名詞）未經驗證；Doc 1 說「架構階段定案」但 Doc 2 實際上選了 zhparser（pgroonga 備選），Doc 3 又出現 pg_jieba——等於沒定案。
- **降險**：Phase 1 開工前做 1~2 天 spike：拿 50~100 份真實公司文件＋20 條驗收查詢（含「凱銳光電→凱銳」、料號、中英混排），比較 zhparser（＋自訂繁中詞庫）vs pgroonga。**傾向 pgroonga 作為 zh-TW 預設**（n-gram 對繁中魯棒、免詞庫維護），代價是自建 DB image 較重。定案後同步三份文件。

### R3.【中】中文 embedding 品質＋day-1 自架推論的維運負擔
B.8 建議從 local BGE-M3 起步（合規上正確），但這把「自架推論服務」提前到 Phase 2 就是硬依賴；且 10 萬頁/百萬 chunk 的全量重嵌在 CPU 上可能以天計。
- **降險**：建 30~50 題 golden question 檢索評測集（繁中真實問法），任何 embedding/分詞/chunking 變更都跑一次；重嵌 job 設計為批次＋斷點續跑＋進度回報（F-ADMIN-04 已有 UI 承接）；預先評估推論硬體（無 GPU 時 BGE-M3 CPU 吞吐），若初期不可行，備案為 Voyage 起步＋保留 reindex 遷移路徑，並以 NFR-COMP-02 的外呼盤點揭露。

### R4.【中】pgvector 規模與「權限過濾×HNSW」召回問題
1M chunk × 1024 維 float ≈ 4GB 向量＋HNSW 圖，DB 記憶體要預算；更關鍵：HNSW 加高選擇性過濾條件（使用者只可讀少數 space）時，top-k 可能召回不足或退化。
- **降險**：要求 pgvector ≥ 0.8 並啟用 iterative index scan；檢索時 over-fetch（k=40 再過濾取 20）；調 `hnsw.ef_search`；記憶體吃緊時評估 `halfvec`；用接近真實規模的合成資料做一次基準測試（納入 NFR-PERF-03 驗收）。

### R5.【中】編輯鎖是 v1 唯一防衝突機制，設計密度不足
C1 決策後，鎖的租期/續租/瀏覽器 crash 釋放/搶鎖/與版本快照 session 邊界的互動，目前只有三行驗收標準。
- **降險**：補一份併發設計短文（狀態機＋時序圖），並將「雙人同時編輯」列入 Playwright E2E 必測情境（NFR-MAINT-01 已要求樹操作/權限測試，加上此項）。

### R6.【低】引用跳轉錨點脆弱
F-AI-05 用 heading_path 定位，heading 改字後歷史引用與 chunk 錨點失效。
- **降險**：TipTap heading/block 節點加持久 `id` attribute（存入 JSON），`page_embeddings` 記 block id 而非文字路徑；F-EDIT-03 的錨點生成規則同步改為 id-based。

---

## 四、修正優先順序建議（供下一輪文件修訂）

1. **先做決策**（阻塞其他修訂）：C1 編輯鎖模型、C2 發布閘門有無、R2 中文分詞選型、C4 可見性三態。
2. **schema 一次補齊**（避免 Phase 1 後改表）：C3 commenter、C5 groups、G1 slug history、G3 AI 三表、G8/G9 小表、G10 預留。
3. **文件對齊**：C6~C12 逐條改；Doc 1 統計數字重算；Doc 3 每元素標 F-編號與 phase。
4. **補設計**：G2 匯入流程、G7 五張 wireframe、R5 併發短文。

---

### Critical Files for Implementation
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/lib/db/schema.ts（本審查多數修正的落點：鎖欄位、commenter、groups、slug history、AI 對話/用量表、visibility 三態）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/lib/authz/permission.ts（群組主體、commenter、org_write 可見性納入唯一權限入口，直接影響 RAG 過濾 SQL）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/lib/rag/retriever.ts（hybrid 檢索＋權限過濾＋HNSW 召回調校，R4 的實作點）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/actions/page.ts（savePage 的編輯鎖＋樂觀版本檢查＋衍生內容同步＋slug 歷史寫入，C1/C2/G1 的匯聚點）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/docs/specs/functional-requirements.md（Doc 1 修訂版：優先級修正、統計重算、與 NFR/UI 對齊後的單一需求來源）
