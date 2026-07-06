# JetBook 功能需求規格書（Functional Requirements Specification）

- 專案：JetBook — 捷揚光電內部知識管理系統（功能對標 GitBook，程式碼與視覺設計全數原創）
- 版本：v1.1（套用完整性審查修正之修訂版）
- 日期：2026-07-06
- 優先級方法：MoSCoW（Must / Should / Could / Won't-for-v1），以「內部知識庫最快可用」為判斷基準
- 使用者規模假設：數十至數百名內部員工，繁體中文為預設 UI 語言

## 修訂紀錄

| 版本 | 日期 | 說明 |
|---|---|---|
| v1.0 | 2026-07-06 | 初版（規劃階段交付物） |
| v1.1 | 2026-07-06 | 套用完整性審查修正：C1（軟性編輯鎖參數定案）、C2（確認全文無草稿/發布閘門）、C3（commenter 四級角色）、C4（visibility 三態）、C8（稽核/備份升 Must）、C9（Drizzle 檔案路徑）、C10（效能數字以 NFR 表為唯一來源）、C11（標題 H1–H3／TOC 取 H2-H3／⌘K 雙義）、C12（統計數字重算）、G1（slug 歷史表）、G4（embedding 維度變更流程）、G5（新增 F-PAGE-08 死鏈處理）、G6（新增 F-ADMIN-07 附件治理；F-PAGE-05 補附件歸屬轉移）、G8（新增 F-ORG-06 釘選、F-SEC-10 權限申請；標籤/公告/頁尾回饋/側欄隱藏明列 Won't）、G9（最近瀏覽資料來源 page_visits）、R2（中文分詞 M0 spike 定案）、R6（id-based 錨點）。修訂後統計：Must 42／Should 28／Could 17／Won't 7（共 94 項） |

對標來源（僅作功能清單比對，未抄襲文案）：GitBook 官方文件之 Spaces/Collections、Block Editor、Change Requests、Git Sync、AI（Assistant/Agent/AI Search/MCP）、Published Sites、Integrations、Import/Export、Roles 等功能領域。
Sources: [GitBook Concepts](https://gitbook.com/docs/resources/concepts)、[GitBook Docs](https://gitbook.com/docs)、[Change requests](https://gitbook.com/docs/collaboration/change-requests/change-requests-in-a-space)、[GitBook Blocks](https://gitbook.com/docs/creating-content/blocks)、[GitBook Changelog](https://gitbook.com/docs/changelog)

---

## 0. 範圍原則（Scope Principles）

1. v1 目標：員工能登入 → 建立/組織/編輯文件 → 全文與語意搜尋 → 對知識庫做 RAG 問答（附引用）→ 管理者能管人管權限。以上鏈路完整可用即可上線。
2. v1 刻意簡化：不做即時多人共編（以編輯鎖與版本快照防衝突）、不做 Git Sync、不做對外公開發佈、不做整合市集。
3. v1 內容工作流定案（C1/C2 決議）：採「**直接編輯＋autosave＋自動版本快照**」，**無草稿/發布閘門**（無發布按鈕、無草稿狀態、版本歷史不分「已發布版」）；防衝突採「**軟性編輯鎖＋樂觀版本檢查**」雙層機制（見 F-COLLAB-01）。
4. 所有 Must 需求構成 v1 驗收範圍；Should 為 v1.x 快速跟進；Could 為排程彈性項；Won't 明確排除以控制範圍。
5. 效能相關驗收數字以《非功能需求規格》（NFR）效能表為唯一來源（C10 決議），本文僅引用不另定義。

---

## 1. 組織與空間管理（F-ORG）

### F-ORG-01 單一工作區（Workspace）
- 描述：系統以單一組織（Jet Opto）為範圍運作，所有 Space、成員、設定皆隸屬此工作區；不做多租戶。
- 優先級：Must
- 驗收標準：
  1. 全系統資料以單一 organization 邊界隔離，資料模型預留 org_id 欄位以利未來擴充。
  2. 工作區名稱、Logo 可由管理者設定。

### F-ORG-02 Space（知識空間）管理
- 描述：Space 為一組相關頁面的容器（如「產品手冊」「IT SOP」），是權限與發佈的基本單位。支援建立、重新命名、設定圖示與描述。
- 優先級：Must
- 驗收標準：
  1. 具建立權限的使用者可建立 Space 並成為其管理者。
  2. Space 列表依權限過濾，僅顯示使用者可存取者。
  3. Space 可設定名稱、圖示（emoji）、描述，以及三態可見性（見 F-SEC-05）。

### F-ORG-03 Collection（空間分組）
- 描述：以 Collection 將多個 Space 分組（如依部門），支援巢狀，並可在 Collection 層級批次設定權限。
- 優先級：Should
- 驗收標準：
  1. Space 可拖曳移入/移出 Collection。
  2. Collection 權限可向下繼承至其中的 Space，Space 可覆寫。

### F-ORG-04 Space 封存與刪除
- 描述：Space 可封存（唯讀、不出現在預設列表與搜尋）與軟刪除，30 天內可還原。
- 優先級：Should
- 驗收標準：
  1. 封存後內容唯讀且預設不進搜尋結果。
  2. 軟刪除的 Space 可由管理者在 30 天內還原，逾期由排程清除。

### F-ORG-05 Space 範本
- 描述：由既有 Space 建立範本（如「專案文件範本」），新 Space 可自範本初始化頁面結構。
- 優先級：Could
- 驗收標準：
  1. 自範本建立的 Space 完整複製頁面樹與內容。

### F-ORG-06 Space 釘選頁面
- 描述：Space 管理者可將重點頁面釘選於 Space 首頁（資料模型：`space_pinned_pages` 表），最多 6 個，供成員快速進入常用文件。
- 優先級：Should（G8 補列）
- 驗收標準：
  1. 釘選/取消釘選即時反映於 Space 首頁；達 6 個上限時再釘選有明確提示。
  2. 被釘選頁面遭刪除或移出該 Space 時，對應釘選項自動移除。

---

## 2. 頁面與內容結構（F-PAGE）

### F-PAGE-01 頁面樹（多層級目錄）
- 描述：每個 Space 有一棵頁面樹，支援任意深度巢狀、拖曳排序與改變層級，作為左側導覽。
- 優先級：Must
- 驗收標準：
  1. 支援至少 5 層巢狀；拖曳後順序與層級即時持久化。
  2. 頁面樹依使用者權限渲染。

### F-PAGE-02 頁面 CRUD
- 描述：使用者可在頁面樹任意位置新增、重新命名、刪除頁面；刪除進入回收桶。頁面採直接編輯＋自動儲存模型，無草稿/發布狀態（C2 決議）。
- 優先級：Must
- 驗收標準：
  1. 新增頁面即進入編輯器且自動儲存。
  2. 刪除含子頁面時提示影響範圍，整支子樹進回收桶。

### F-PAGE-03 固定連結與 Slug
- 描述：每頁有穩定 URL（space-slug/page-slug），改標題可更新 slug 但舊連結 301 導向新址；舊 slug 由 `page_slug_history` 表持久保存（G1）。
- 優先級：Must
- 驗收標準：
  1. slug 衝突自動加尾碼；中文標題產生可讀 slug 或短 ID。
  2. 舊 slug 永久 301 導向（路由 resolver 先查現行 slug，未命中則查 `page_slug_history` 回 301），內部引用不因改名失效；跨 Space 移動（F-PAGE-05）之舊路徑亦經此表導向。

### F-PAGE-04 群組節點與外部連結節點
- 描述：頁面樹支援「群組標題」（僅分節、無內文）與「外部連結」兩種特殊節點。
- 優先級：Should
- 驗收標準：
  1. 群組節點在導覽顯示為分節標題且不可開啟為頁面。
  2. 外部連結節點點擊以新分頁開啟目標 URL。

### F-PAGE-05 頁面移動與複製
- 描述：頁面（含子樹）可在同 Space 內移動，亦可移動或複製到其他有權限的 Space。
- 優先級：Should
- 驗收標準：
  1. 跨 Space 移動後，附件、版本歷史與內部連結導向仍有效。
  2. 跨 Space 移動時，頁面所引用附件之 space 歸屬（`attachments.space_id`）同步轉移，附件的權限檢查即刻跟隨目的地 Space（G6）。

### F-PAGE-06 回收桶
- 描述：Space 層級回收桶保存被刪頁面 30 天，可還原至原位置。
- 優先級：Should
- 驗收標準：
  1. 還原後頁面回到原父節點（父節點已刪則掛回根層）。
  2. 回收桶內容不出現在搜尋與 RAG 檢索。

### F-PAGE-07 頁面中繼資料
- 描述：頁面可設定描述、emoji 圖示；系統自動記錄建立者、最後編輯者與時間並顯示於頁首。
- 優先級：Could
- 驗收標準：
  1. 頁首顯示最後更新時間與編輯者。

### F-PAGE-08 死鏈（Broken Link）處理
- 描述：行內頁面連結以 page id 為目標（改名不失效，見 F-EDIT-12）；當連結目標頁面已刪除（位於回收桶或已清除）時，閱讀與編輯模式將該連結渲染為「已刪除頁面」樣式 chip，避免使用者點擊後遇到 404。
- 優先級：Should（G5 補列）
- 驗收標準：
  1. 目標頁面進入回收桶後，指向它的內部連結顯示「已刪除頁面」chip；具還原權限者可由 chip 直達回收桶進行還原。
  2. 目標頁面自回收桶還原後，原連結自動恢復正常渲染。
  3. v1.x：背景掃描 job 產出全站死鏈報表（併入 F-ADMIN-06 內容分析）；外部 URL 失效檢查列為 Could。

---

## 3. 編輯器與內容元素（F-EDIT）

技術基調：TipTap（ProseMirror）為編輯器核心，文件以結構化 JSON 存於 PostgreSQL；區塊功能一律優先採用現成 TipTap extensions，不自研（R1 降險）。

### F-EDIT-01 區塊式 WYSIWYG 編輯器
- 描述：所見即所得的區塊編輯器，支援區塊拖曳排序、區塊選取與複製，內容自動儲存。
- 優先級：Must
- 驗收標準：
  1. 編輯過程每隔數秒自動儲存，離開前未儲存變更有防護提示。
  2. 區塊可拖曳重排且順序持久化。

### F-EDIT-02 Slash 指令選單
- 描述：輸入「/」呼出區塊插入選單，支援關鍵字過濾（含中文名稱），為插入所有區塊型別的統一入口。
- 優先級：Must
- 驗收標準：
  1. 選單涵蓋所有已實作區塊，鍵盤可完整操作（上下選擇、Enter 插入）。

### F-EDIT-03 基本文字區塊與行內格式
- 描述：段落、標題 H1–H3（不支援 H4 以下，C11 決議）、粗體、斜體、刪除線、底線、行內程式碼、超連結。
- 優先級：Must
- 驗收標準：
  1. 支援快捷鍵（Cmd/Ctrl+B/I/U 等）；Cmd/Ctrl+K 於「編輯模式且有文字選取」時觸發插入連結，其餘情境為全域搜尋面板（雙義定義見 F-SEARCH-02，C11 決議）。
  2. H1–H3 自動產生錨點；錨點以持久 block id 為基礎（id 存於文件 JSON，不隨標題文字改動而失效），供頁內目錄（TOC）、頁面連結與 RAG 引用跳轉使用（R6 決議）。

### F-EDIT-04 清單區塊
- 描述：無序清單、有序清單、任務清單（checkbox），支援巢狀縮排。
- 優先級：Must
- 驗收標準：
  1. Tab/Shift+Tab 調整縮排；任務清單勾選狀態持久化。

### F-EDIT-05 Markdown 快捷輸入與貼上轉換
- 描述：支援 Markdown 語法即時轉換（如 `#`、`-`、`>`、```）；貼上 Markdown 文字自動解析為對應區塊。
- 優先級：Must
- 驗收標準：
  1. 常用 Markdown 前綴輸入後即時轉為對應區塊。
  2. 貼上多段 Markdown（含程式碼區塊、表格）正確轉換。

### F-EDIT-06 程式碼區塊
- 描述：具語法高亮的程式碼區塊，可選語言、顯示行號、一鍵複製、可加標題（caption）。
- 優先級：Must
- 驗收標準：
  1. 至少支援 20 種常用語言的高亮。
  2. 閱讀模式提供複製按鈕。

### F-EDIT-07 表格區塊
- 描述：支援插入表格，可增刪列欄、表頭列、儲存格內基本格式。
- 優先級：Must
- 驗收標準：
  1. 可增刪列欄且內容不遺失；閱讀模式寬表格可水平捲動。

### F-EDIT-08 提示區塊（Hint/Callout）
- 描述：Info / Warning / Danger / Success 四種樣式的提示框，內可含多段內容。
- 優先級：Must
- 驗收標準：
  1. 四種樣式視覺可辨識，可在樣式間切換不失內容。

### F-EDIT-09 圖片區塊
- 描述：支援上傳、拖放、剪貼簿貼上圖片；可設定替代文字與說明文字，點擊放大檢視。
- 優先級：Must
- 驗收標準：
  1. 貼上截圖即自動上傳並插入；檔案存於物件儲存/檔案系統（非 DB blob），路徑外部化設定。
  2. 支援常見格式（PNG/JPG/GIF/WebP/SVG），有大小上限與錯誤提示。

### F-EDIT-10 檔案附件區塊
- 描述：上傳任意類型檔案（PDF、Office、壓縮檔等）為附件區塊，顯示檔名、大小與下載按鈕。
- 優先級：Must
- 驗收標準：
  1. 下載受頁面權限保護（未授權者取得連結亦不可下載）。
  2. 可設定允許的副檔名與大小上限。

### F-EDIT-11 引用與分隔線
- 描述：引用（quote）區塊與水平分隔線。
- 優先級：Must
- 驗收標準：
  1. 可經 slash 選單與 Markdown 快捷（`>`、`---`）插入。

### F-EDIT-12 頁面連結與 @Mention
- 描述：行內插入指向其他頁面的連結（輸入時可搜尋頁面標題），連結以 page id 為目標；支援 @ 提及使用者。
- 優先級：Should
- 驗收標準：
  1. 被連結頁面改名後連結文字自動更新且不失效；目標被刪除時依 F-PAGE-08 顯示「已刪除頁面」chip。
  2. @ 提及觸發通知（依 F-NOTIF-01）。

### F-EDIT-13 進階版面區塊：Tabs / 摺疊（Expandable）/ 步驟（Stepper）
- 描述：分頁籤內容、可摺疊段落、逐步教學步驟三種互動區塊。
- 優先級：Should
- 驗收標準：
  1. 閱讀模式可正常互動；搜尋與 RAG 索引涵蓋其內部文字。

### F-EDIT-14 Mermaid 圖表區塊
- 描述：以 Mermaid 語法撰寫流程圖、時序圖等，編輯時即時預覽。
- 優先級：Should
- 驗收標準：
  1. 語法錯誤顯示錯誤訊息而非整頁崩潰。

### F-EDIT-15 內嵌（Embed）區塊
- 描述：貼上 URL 內嵌外部內容（YouTube、Figma、Google 簡報等），不支援者退化為連結卡片。
- 優先級：Should
- 驗收標準：
  1. 允許的 embed 網域白名單可由管理者設定（內網安全考量）。

### F-EDIT-16 數學公式區塊（KaTeX）
- 描述：行內與區塊級 LaTeX 數學式渲染。
- 優先級：Could
- 驗收標準：
  1. 常見 LaTeX 語法正確渲染，錯誤語法顯示原始碼。

### F-EDIT-17 多欄版面（Columns）
- 描述：將區塊並排為 2–3 欄版面。
- 優先級：Could
- 驗收標準：
  1. 窄螢幕自動退化為單欄堆疊。

### F-EDIT-18 可重用內容（Snippets）
- 描述：將一段內容存為可重用片段，多頁引用，來源更新時引用處同步更新。
- 優先級：Could
- 驗收標準：
  1. 更新來源片段後所有引用頁面顯示新內容。

### F-EDIT-19 頁內目錄（TOC）
- 描述：閱讀模式右側自動生成本頁標題目錄，捲動時高亮當前章節。
- 優先級：Should
- 驗收標準：
  1. 目錄依 H2/H3 自動生成（頁面標題本身即 H1，不重複列入；C11 決議），點擊平滑捲動至錨點。

---

## 4. 協作與審閱（F-COLLAB）

### F-COLLAB-01 編輯鎖與衝突防護
- 描述：v1 不做即時共編；採「軟性編輯鎖＋樂觀版本檢查」雙層防護（C1 決議）：同一頁面同時僅允許一人編輯，鎖狀態記錄於 pages 的 `locked_by`/`locked_at` 欄位；其他人看到「某某編輯中」banner 並以唯讀檢視；儲存時以 `current_version_no` 樂觀檢查作為第二道防線，防止舊資料覆寫。
- 優先級：Must
- 驗收標準：
  1. 第二位使用者進入編輯時被告知鎖定狀態，僅能唯讀檢視，無法覆寫。
  2. 鎖以心跳續租（每 30 秒），閒置 5 分鐘自動釋放；瀏覽器崩潰或斷線後，鎖最遲於逾時後可被他人取得。
  3. Admin 可強制搶鎖（需確認對話框）；原持鎖者立即降為唯讀並收到提示，其未儲存內容保留於編輯器記憶體不遺失。
  4. 儲存時版本號不符則拒絕寫入並提示重新載入（樂觀版本檢查備援）。
  5. 「雙人同時編輯」情境列入 Playwright E2E 必測（R5）。

### F-COLLAB-02 頁面留言
- 描述：每頁底部或側欄的留言串，支援回覆、編輯、刪除與已解決標記。
- 優先級：Should
- 驗收標準：
  1. 留言支援 @ 提及並觸發通知。
  2. 標記已解決後預設收合。

### F-COLLAB-03 變更請求（Change Request）
- 描述：類 PR 工作流：從當前內容開分支草稿編輯，送審指定審閱者，核可後合併回主內容，全程保留審閱紀錄。（此為 v1.x 功能；v1 內容模型無草稿/發布狀態，本項上線時再引入分支草稿資料模型。）
- 優先級：Should（v1 先以直接編輯＋版本歷史運作；此為 v1.x 首要協作強化）
- 驗收標準：
  1. 變更請求可預覽與主內容的 diff。
  2. 合併時若主內容已被他人更動，提示衝突並要求更新後再合併。

### F-COLLAB-04 行內評論
- 描述：對頁面中選取的文字段落錨定評論。
- 優先級：Could
- 驗收標準：
  1. 被評論文字後續遭編輯時，評論退化為頁面層級留言而非遺失。

### F-COLLAB-05 即時多人共編
- 描述：多人同時編輯同一頁、游標可見（CRDT/Yjs）。
- 優先級：Won't-for-v1（v2 評估，屆時以 Yjs + TipTap collaboration 實作）
- 驗收標準：不適用。

---

## 5. 版本控制（F-VER）

### F-VER-01 自動版本快照
- 描述：每次編輯階段結束（closed editing session 或編輯鎖釋放）自動產生版本快照，記錄作者與時間；不依賴使用者手動存版，亦無「發布版」概念（C2 決議：所有快照地位等同）。
- 優先級：Must
- 驗收標準：
  1. 編輯後版本歷史出現新版本，含作者、時間戳。
  2. 高頻編輯以 session 合併，避免產生數百筆微版本。

### F-VER-02 版本歷史檢視
- 描述：頁面層級版本列表，可開啟任一歷史版本以唯讀方式檢視完整內容。
- 優先級：Must
- 驗收標準：
  1. 歷史版本渲染結果與當時內容一致（含區塊與圖片）。

### F-VER-03 版本還原
- 描述：具編輯權者可將頁面還原至任一歷史版本；還原本身也產生新版本（不可變歷史）。
- 優先級：Must
- 驗收標準：
  1. 還原後內容與所選版本一致，且歷史鏈完整保留。

### F-VER-04 版本差異比較（Diff）
- 描述：任兩版本間的內容差異視覺化（新增/刪除/修改的區塊與文字標示）。
- 優先級：Should
- 驗收標準：
  1. 文字層級增刪以顏色標示（中文採詞級 diff）；區塊增刪明確可辨。

### F-VER-05 Git Sync（雙向同步 GitHub/GitLab）
- 描述：內容與 Git repo 雙向同步的 docs-as-code 工作流。
- 優先級：Won't-for-v1（Markdown 匯入/匯出可滿足初期 docs-as-code 遷移需求）
- 驗收標準：不適用。

---

## 6. 搜尋（F-SEARCH）

### F-SEARCH-01 全文搜尋
- 描述：跨 Space 的關鍵字全文搜尋，基於 PostgreSQL full-text search；因中文無空格斷詞，須配置中文分詞——選型（zhparser vs pgroonga，審查傾向 pgroonga）由 **M0 spike** 以 50–100 份真實公司文件＋20 條驗收查詢定案（R2 決議），結果附高亮摘要。
- 優先級：Must
- 驗收標準：
  1. 以繁體中文詞彙查詢可命中標題與內文（非僅整句完全比對）。
  2. 結果僅含使用者有讀取權的頁面。
  3. 標題命中權重高於內文；結果顯示命中片段高亮。

### F-SEARCH-02 快速開啟面板（Cmd+K）
- 描述：全域快捷鍵呼出搜尋面板，即時顯示頁面結果，Enter 直達頁面；為搜尋與 AI 問答的統一入口。
- 優先級：Must
- 驗收標準：
  1. 按 Cmd/Ctrl+K 可呼出面板；即時結果延遲依 NFR 效能表（typeahead P95 ≤ 200ms；C10 決議）。
  2. 面板內可切換「搜尋」與「AI 問答」模式。
  3. ⌘K 雙義（C11 決議）：**編輯模式且有文字選取時 = 插入連結**（F-EDIT-03）；**其餘情境 = 呼出全域搜尋面板**。

### F-SEARCH-03 搜尋過濾器
- 描述：搜尋結果可依 Space、最後更新時間、作者過濾與排序。
- 優先級：Should
- 驗收標準：
  1. 過濾條件可組合使用且結果正確。

---

## 7. AI 功能（F-AI）— 核心賣點

### F-AI-01 LLM Provider 抽象層
- 描述：所有 LLM 呼叫經統一介面（chat completion、streaming、tool use），v1 實作 Anthropic Claude API adapter 與 OpenAI-compatible adapter（Ollama/vLLM），以環境變數切換 provider 與模型，業務程式碼零修改。
- 優先級：Must
- 驗收標準：
  1. 僅改環境變數即可從 Claude 切至 OpenAI-compatible endpoint，RAG 問答功能不需改碼即運作。
  2. 介面支援 streaming 回應與 token 用量回報。

### F-AI-02 Embedding Provider 抽象層
- 描述：Embedding 產生走統一介面，支援本地模型/Voyage/OpenAI-compatible；v1 自 day-1 採用 local BGE-M3（1024 維），避免日後全庫重嵌（已拍板決策）。向量維度作為索引中繼資料儲存，換模型時觸發全庫重嵌。
- 優先級：Must
- 驗收標準：
  1. 切換 embedding provider 後可執行重嵌工作並完成索引重建。
  2. 系統拒絕混用不同模型/維度的向量進行檢索。
  3. 更換為不同維度之模型時，依文件化的四步流程執行（G4 決議）：schema migration（新欄/新表）→ 全量重嵌 → 切換 → 清理；流程詳見系統架構文件。

### F-AI-03 內容嵌入管線（Indexing Pipeline）
- 描述：頁面建立/更新/刪除後，背景工作自動進行 chunking（依標題層級與區塊邊界切塊）、產生 embedding、寫入 pgvector；增量更新僅處理變動頁面。
- 優先級：Must
- 驗收標準：
  1. 頁面更新後新內容可被語意檢索，索引延遲依 NFR 效能表（P95 ≤ 60 秒；C10 決議）。
  2. 每個 chunk 保留來源頁面 ID 與持久 block id 錨點（R6 決議），供引用跳轉。
  3. 管線失敗有重試與死信記錄，不阻塞編輯操作。

### F-AI-04 RAG 知識問答（附引用來源）
- 描述：使用者以自然語言提問，系統以 hybrid 檢索（向量＋全文）取得相關 chunk，交由 LLM 生成繁體中文回答，並列出引用來源；檢索範圍嚴格受使用者讀取權限過濾。
- 優先級：Must
- 驗收標準：
  1. 回答附至少一個引用來源（頁面標題＋連結），無足夠依據時明確回覆「知識庫中找不到相關資訊」而非虛構。
  2. 使用者無權限的內容絕不出現在回答或引用中（以權限過濾後才進入 prompt）。
  3. 回答以 streaming 呈現，首 token 時間依 NFR 效能表（TTFT P95 ≤ 4 秒；C10 決議）。

### F-AI-05 引用跳轉
- 描述：點擊回答中的引用可跳轉至來源頁面並捲動、高亮對應段落。
- 優先級：Must
- 驗收標準：
  1. 點擊引用開啟來源頁並定位至對應 chunk 的 block id 錨點區塊（標題文字改動不影響定位；R6 決議）。

### F-AI-06 語意搜尋（AI Search）
- 描述：搜尋面板支援語意模式：以意圖而非關鍵字命中內容（如查「請假規定」可命中「休假辦法」），與全文搜尋結果融合排序（hybrid + rerank 規則）。
- 優先級：Must
- 驗收標準：
  1. 同義詞/近義表述查詢可命中未含原詞的相關頁面。
  2. 結果同樣受權限過濾。

### F-AI-07 問答對話（多輪）與歷史
- 描述：RAG 問答支援多輪追問（保留對話上下文重寫查詢），使用者可查看自己的歷史對話。
- 優先級：Should
- 驗收標準：
  1. 追問（如「那流程是什麼？」）能利用前文正確改寫檢索查詢。
  2. 對話紀錄僅本人與管理者（稽核用途）可見。

### F-AI-08 寫作輔助（編輯器內 AI）
- 描述：編輯器中選取文字或於空白處呼叫 AI：改寫（語氣/精簡）、續寫、摘要、翻譯（中英互譯）、修正錯字文法；結果以建議形式插入，使用者確認後才生效。
- 優先級：Should（v1.x 首批；其中「摘要」與「翻譯」優先）
- 驗收標準：
  1. 選取文字後可執行改寫/摘要/翻譯，結果可「取代」「插入下方」或「捨棄」。
  2. AI 產出永不直接覆寫原文（需明確確認）。

### F-AI-09 AI 生成頁面初稿
- 描述：從標題或大綱提示生成整頁初稿（可引用知識庫既有內容作為脈絡），生成結果建立為一般頁面供人工修訂（v1 內容模型無草稿/發布狀態，建立即為正式頁面；C2 決議）。
- 優先級：Could
- 驗收標準：
  1. 生成內容為合法的編輯器區塊結構（非純文字傾倒）。

### F-AI-10 頁面摘要與「本頁問答」
- 描述：閱讀頁面時可一鍵取得本頁摘要，或僅以本頁為範圍提問。
- 優先級：Could
- 驗收標準：
  1. 摘要與回答僅依據當前頁面內容。

### F-AI-11 AI 用量治理
- 描述：管理者可設定每人/每日的 AI 呼叫額度與速率限制，並檢視 token 用量統計（依 provider 計）。
- 優先級：Should
- 驗收標準：
  1. 超額時前端明確提示，後端拒絕請求。
  2. 用量統計可按使用者與功能（問答/寫作輔助）分項。

### F-AI-12 回答回饋
- 描述：對 AI 回答按讚/倒讚並附註原因，供後續調校檢索與 prompt。
- 優先級：Could
- 驗收標準：
  1. 回饋與對應問答、檢索到的 chunk 一併保存。

### F-AI-13 自主 AI Agent（自動開變更請求、代理編輯）
- 描述：對標 GitBook Agent 的自主文件代理。
- 優先級：Won't-for-v1
- 驗收標準：不適用。

---

## 8. 權限與安全（F-SEC）

### F-SEC-01 本地帳號認證（Email/密碼）
- 描述：Email＋密碼註冊登入；密碼以強雜湊（Argon2id）儲存；帳號由管理者建立或邀請（不開放自由註冊）。
- 優先級：Must
- 驗收標準：
  1. 密碼強度原則可設定（長度、複雜度）；登入失敗次數限制與鎖定。
  2. 忘記密碼經 Email 重設連結（有效期限、單次使用）。

### F-SEC-02 Session 管理
- 描述：安全的 session（httpOnly、SameSite cookie），支援登出與閒置逾時；session 儲存外部化（DB）以符合 stateless 部署。
- 優先級：Must
- 驗收標準：
  1. 多副本部署下 session 仍有效（不依賴單機記憶體）。
  2. 使用者可登出所有裝置。

### F-SEC-03 OIDC/SSO 介面預留
- 描述：認證層以可插拔 provider 設計，本地帳號為 v1 唯一 provider，但帳號模型（外部 identity 關聯表）、登入流程與設定皆預留 OIDC，以便日後接 Azure AD 無須改資料模型。
- 優先級：Must（架構預留）；實際 Azure AD 整合為 Won't-for-v1
- 驗收標準：
  1. 資料模型支援一個使用者關聯多個 identity provider。
  2. 新增 OIDC provider 僅需設定與 adapter，不動核心授權邏輯。

### F-SEC-04 系統角色
- 描述：工作區層級角色：Admin（全域管理）、Member（一般成員）；搭配 Space 層級角色構成完整授權。
- 優先級：Must
- 驗收標準：
  1. 僅 Admin 可進入管理後台與管理使用者。

### F-SEC-05 Space 層級權限
- 描述：每個 Space 具三態可見性（C4 決議）：`private`（僅被授權者可見）｜`org_read`（全體登入成員可讀）｜`org_write`（全體登入成員可讀寫）；並可對個人或群組授予 Space 角色（C3 決議，四級）：**admin / editor / commenter / viewer**。

  權限矩陣：

  | 能力 | admin | editor | commenter | viewer |
  |---|---|---|---|---|
  | 閱讀內容 | ✓ | ✓ | ✓ | ✓ |
  | 留言（F-COLLAB-02） | ✓ | ✓ | ✓ | — |
  | 編輯內容 | ✓ | ✓ | — | — |
  | 管理 Space 設定與權限 | ✓ | — | — | — |

- 優先級：Must（commenter 能力隨 F-COLLAB-02 一併釋出；留言功能上線前 commenter 行為等同 viewer，但 schema 自 Phase 1 即含此角色）
- 驗收標準：
  1. `private` Space 對未授權者完全不可見（列表、搜尋、RAG、直接 URL 皆拒絕）。
  2. `org_read` 下全體登入成員可讀不可改；`org_write` 下全體登入成員具 editor 等級編輯能力；個別/群組授權可在此基礎上再提升（如指派 space admin）。
  3. 權限變更即時生效（下一請求即受新權限約束）。
  4. 四級角色能力與上表一致，`lib/authz/permission.ts` 為唯一授權入口。

### F-SEC-06 使用者群組（Teams）
- 描述：管理者建立群組（如「研發部」），權限可授予群組（授權主體泛化為 user | group），成員異動自動反映授權。
- 優先級：Should（schema 於 Phase 1 預留 `groups`/`group_members`，為未來 AD/SSO 群組映射前置）
- 驗收標準：
  1. 將使用者移出群組後，其經由該群組取得的存取立即失效。

### F-SEC-07 稽核日誌（Audit Log）
- 描述：記錄安全敏感事件：登入/登出/失敗、權限變更、Space/頁面刪除、匯出、管理設定變更、AI 問答查詢事件。日誌 append-only、保留至少 1 年（與 NFR-SEC-06 P0 對齊）。
- 優先級：**Must**（C8 決議：由 Should 升級，與 NFR P0 對齊；實作成本低、風險高，不延後）
- 驗收標準：
  1. 事件含操作者、時間、對象、來源 IP；僅 Admin 可查詢。
  2. 日誌為 append-only，一般操作介面無刪改途徑；保留期限至少 1 年。

### F-SEC-08 傳輸與檔案安全
- 描述：全站 HTTPS（反向代理層）、上傳檔案型別驗證與病毒掃描掛鉤預留、附件存取一律經權限檢查的授權 URL。
- 優先級：Must
- 驗收標準：
  1. 附件無法以可猜測的公開 URL 直接存取。

### F-SEC-09 雙因素驗證（2FA）
- 描述：TOTP 雙因素。
- 優先級：Won't-for-v1（內網部署＋後續 SSO 將由 AD 端控管）
- 驗收標準：不適用。

### F-SEC-10 權限申請（403 申請存取）
- 描述：使用者開啟無權限的 Space/頁面時（且該資源存在），403 頁提供「向管理員申請權限」動作；送出後通知該 Space 管理者（複用 F-NOTIF-01 通知機制），管理者可自通知直達權限設定頁。
- 優先級：Could（G8 補列；依賴 F-NOTIF-01）
- 驗收標準：
  1. 申請送出後，目標 Space 的管理者收到含申請人與目標資源的站內通知。
  2. 同一使用者對同一資源的重複申請有節流（如 24 小時一次）。
  3. `private` Space 的存在性不因 403 申請流程而洩漏（不存在與無權限的回應不可區分時，不顯示申請入口）。

---

## 9. 發佈與分享（F-PUB）

### F-PUB-01 閱讀模式（內部發佈）
- 描述：所有內容對有權限的登入使用者以乾淨的閱讀版面呈現（導覽樹＋內文＋頁內 TOC＋上一頁/下一頁），與編輯模式明確分離。
- 優先級：Must
- 驗收標準：
  1. viewer 角色只見閱讀模式，無任何編輯 UI。
  2. 閱讀版面於桌面與行動瀏覽器均可正常使用（RWD）。

### F-PUB-02 頁面連結分享
- 描述：一鍵複製頁面（含錨點）連結分享給同事，開啟時經登入與權限檢查。
- 優先級：Must
- 驗收標準：
  1. 未登入者開啟連結→登入後直達原頁面（含錨點位置）。

### F-PUB-03 Space 首頁與瀏覽入口
- 描述：系統首頁呈現使用者可存取的 Space（分組、搜尋框、最近瀏覽/更新）。
- 優先級：Must
- 驗收標準：
  1. 首頁顯示「最近更新」與「最近瀏覽」清單。
  2. 「最近瀏覽」以 `page_visits` 表為資料來源（G9 決議：`user_id, page_id, visited_at`，同頁重訪 upsert 更新、每人保留固定筆數），跨裝置一致；Cmd+K 空狀態的最近瀏覽同源。

### F-PUB-04 對外公開發佈與自訂網域
- 描述：無需登入的公開站點、自訂網域、SEO。
- 優先級：Won't-for-v1（純內部系統）
- 驗收標準：不適用。

### F-PUB-05 訪客分享連結（免登入 token 連結）
- 描述：對單頁產生限期免登入分享連結。
- 優先級：Won't-for-v1（安全單純化）
- 驗收標準：不適用。

---

## 10. 匯入匯出（F-IE）

### F-IE-01 Markdown 匯入
- 描述：上傳單一 .md 檔或含資料夾結構與圖片的 .zip，批次匯入為頁面樹；資料夾層級對應頁面層級，圖片自動上傳並改寫引用。匯入以背景 job 執行（含 zip bomb 上限、路徑穿越檢查、單檔大小限制等安全防護，G2）。
- 優先級：Must（初期內容搬遷的關鍵路徑）
- 驗收標準：
  1. 常見 Markdown 語法（標題、清單、表格、程式碼、圖片）正確轉為對應區塊。
  2. zip 匯入後頁面層級與資料夾結構一致，站內圖片全部可顯示。

### F-IE-02 Markdown 匯出
- 描述：單頁或整個 Space 匯出為 Markdown（Space 匯出為 zip，含圖片與資料夾結構）。
- 優先級：Should
- 驗收標準：
  1. 匯出再匯入（round-trip）後內容不遺失主要結構。

### F-IE-03 其他格式匯入（Word/HTML/Confluence）
- 描述：.docx、HTML、Confluence export 的轉換匯入。
- 優先級：Could
- 驗收標準：
  1. 至少保留標題層級、清單、表格與圖片。

### F-IE-04 PDF 匯出
- 描述：單頁匯出為排版良好的 PDF。
- 優先級：Could
- 驗收標準：
  1. 中文字型正確嵌入，程式碼與表格不破版。

### F-IE-05 系統備份匯出
- 描述：管理者可觸發全站資料備份（DB dump＋附件），供災難復原；亦提供文件化的 CLI/排程備份方案。與 NFR-DATA-01~03（P0）對齊：每日全備＋WAL、異機保存、RPO ≤ 1h／RTO ≤ 4h；DB dump 與附件 volume 備份時間點的不一致視窗須在 runbook 中聲明可接受範圍。
- 優先級：**Must**（C8 決議：由 Should 升級，與 NFR P0 對齊）
- 驗收標準：
  1. 依備份可在乾淨環境完整還原系統。
  2. 備份排程納入部署方案（Docker Compose backup 服務），還原程序文件化並經演練驗證。

---

## 11. 通知（F-NOTIF）

### F-NOTIF-01 站內通知中心
- 描述：鈴鐺式通知中心，彙整與我相關事件：被 @ 提及、留言回覆、權限申請（F-SEC-10）、（未來）變更請求指派與審閱結果。
- 優先級：Should
- 驗收標準：
  1. 未讀計數正確；點擊通知直達對應頁面/留言。

### F-NOTIF-02 Email 通知
- 描述：重要事件（提及、審閱請求）發送 Email，個人可設定開關；SMTP 走外部化設定。（註：SMTP 基礎設施本身為 P0——F-SEC-01 忘記密碼與 F-ADMIN-01 邀請信皆依賴寄信，僅「事件類 Email 通知」為 Could。）
- 優先級：Could
- 驗收標準：
  1. 使用者可於個人設定停用各類 Email 通知。

### F-NOTIF-03 訂閱頁面/Space 更新
- 描述：關注特定頁面或 Space，內容更新時收到通知。
- 優先級：Could
- 驗收標準：
  1. 取消訂閱後不再收到該對象通知。

---

## 12. 管理後台（F-ADMIN）

### F-ADMIN-01 使用者管理
- 描述：Admin 可建立/邀請使用者、停用/啟用帳號、強制重設密碼、指派系統角色。
- 優先級：Must
- 驗收標準：
  1. 停用帳號立即終止其所有 session 且無法再登入。
  2. 支援 Email 邀請流程（首次登入設定密碼）。

### F-ADMIN-02 群組管理
- 描述：建立/編輯群組與成員（支援 CSV 批次匯入成員）。
- 優先級：Should
- 驗收標準：
  1. 群組授權行為符合 F-SEC-06。

### F-ADMIN-03 系統設定外部化
- 描述：所有環境相依設定（DB、物件儲存、SMTP、LLM/Embedding provider 與 API key、base URL）以環境變數注入（12-factor），敏感值不入 repo；後台提供**唯讀**的設定健康檢查頁（顯示各依賴連線狀態，遮罩秘密）。
- 優先級：Must
- 驗收標準：
  1. 同一 image 僅換環境變數即可在不同環境啟動。
  2. 後台可看到 DB/儲存/LLM endpoint 的連線健康狀態。

### F-ADMIN-04 AI 設定與用量頁
- 描述：後台**唯讀**檢視當前 LLM/Embedding provider、模型、遮罩後 API key 末四碼與 token 用量統計（C6：provider 切換僅經環境變數，不提供可編輯表單，不暴露 temperature 等 sampling 參數）；可觸發全庫重嵌任務並顯示進度（重嵌、功能開關、quota 屬 DB 儲存之營運設定，可操作）。
- 優先級：Should
- 驗收標準：
  1. 重嵌任務有進度與失敗清單，可重試。

### F-ADMIN-05 稽核日誌檢視
- 描述：後台查詢介面（依人、事件類型、時間範圍過濾），對應 F-SEC-07。
- 優先級：Should
- 驗收標準：
  1. 查詢結果可匯出 CSV。

### F-ADMIN-06 內容分析
- 描述：熱門頁面、搜尋無結果詞、AI 常見問題等統計，協助找出知識缺口；v1.x 納入死鏈報表（F-PAGE-08）。
- 優先級：Could
- 驗收標準：
  1. 可列出近 30 天搜尋無結果的關鍵字排行。

### F-ADMIN-07 附件治理與儲存用量
- 描述：系統以內容引用計數追蹤附件使用狀態；頁面刪除或內容中移除引用後成為孤兒附件，經 **30 天寬限期**後由背景 GC job 回收；管理後台提供全站與各 Space 儲存用量檢視。
- 優先級：Should（G6 補列）
- 驗收標準：
  1. 孤兒附件於寬限期內因頁面還原或版本還原重新被引用時，不被回收；逾期由 GC job 清除並寫入稽核日誌。
  2. 後台顯示全站與各 Space 的附件數量與儲存用量統計。

---

## 13. API 與整合（F-API）

### F-API-01 REST API
- 描述：對外提供 API：頁面/Space 讀取與 CRUD、搜尋、（可選）RAG 問答，供內部腳本與未來系統整合；附 OpenAPI 規格文件。
- 優先級：Should
- 驗收標準：
  1. API 權限與 UI 一致（同一授權模型）。
  2. 提供自動生成的 OpenAPI 文件頁。

### F-API-02 API Token
- 描述：使用者可建立個人 API token（可設範圍與到期日、可撤銷）供 API 認證。
- 優先級：Should
- 驗收標準：
  1. Token 僅建立當下完整顯示一次；撤銷立即生效。

### F-API-03 Webhooks
- 描述：內容事件（頁面建立/更新/刪除）觸發對外 webhook，可用於通知 Slack/Teams 或觸發下游流程。
- 優先級：Could
- 驗收標準：
  1. 失敗投遞有重試與投遞紀錄。

### F-API-04 MCP Server
- 描述：以 MCP 協定曝露知識庫搜尋/讀取工具，讓公司內的 AI 助理（如 Claude）直接查詢 JetBook。
- 優先級：Could
- 驗收標準：
  1. MCP client 可完成「搜尋→讀取頁面內容」流程且受 token 權限約束。

### F-API-05 第三方整合市集
- 描述：類 GitBook 的 integrations 平台（Slack app、Jira 嵌入等外掛生態）。
- 優先級：Won't-for-v1
- 驗收標準：不適用。

---

## 14. v1 明確不做清單（Won't-for-v1）

| 項目 | 對應編號 | 排除理由 |
|---|---|---|
| 即時多人共編（CRDT/Yjs） | F-COLLAB-05 | 複雜度最高的單一功能；編輯鎖＋版本快照已足夠內部規模 |
| Git Sync（GitHub/GitLab 雙向同步） | F-VER-05 | Markdown 匯入/匯出可滿足初期遷移；雙向同步衝突處理成本高 |
| 對外公開發佈、自訂網域、SEO | F-PUB-04 | 純內部系統，無對外需求 |
| 免登入分享連結 | F-PUB-05 | 內網安全單純化 |
| Azure AD/OIDC 實際整合 | F-SEC-03（僅預留） | v1 本地帳號即可；架構已預留無痛接入 |
| 2FA | F-SEC-09 | 內網＋未來 SSO 由 AD 控管 |
| 自主 AI Agent（代理編輯/自動開變更請求） | F-AI-13 | 先讓 RAG 問答與寫作輔助站穩 |
| 整合市集／外掛生態 | F-API-05 | 生態建設非內部系統目標，以 Webhook/API 替代 |
| 草稿/發布閘門（發布按鈕、草稿狀態、僅發布版篩選） | —（C2 決議） | v1 採直接編輯＋autosave＋自動版本快照；發布閘門若日後需要（如 RAG 只索引已發布內容）於 v2 連同資料模型一併評估 |
| 頁面標籤（tags） | —（G8 砍出 v1） | UI 曾規劃但規格與資料模型皆無；v1 以頁面樹＋搜尋足以組織 |
| Dashboard 公告區 | —（G8 砍出 v1） | 公告需求可暫以 Space 釘選頁面（F-ORG-06）替代 |
| 頁尾「這頁有幫助嗎 👍👎」回饋 | —（G8 砍出 v1） | 頁面層回饋價值待驗證；AI 回答回饋另見 F-AI-12 |
| 頁面「在側欄隱藏」設定 | —（G8 砍出 v1） | 隱藏語意與權限模型易混淆，v1 不引入 |
| 離線編輯（本機持久化＋重連同步） | —（C7 決議） | 降級為「連線中斷提示＋編輯器記憶體保留＋自動重試儲存」，不承諾本機持久化 |
| 多語系內容變體（adaptive/translated sites） | — | UI 繁中單語系即可；翻譯需求由 AI 寫作輔助涵蓋 |
| OpenAPI/API 文件專用區塊 | — | 非知識庫核心；程式碼區塊可暫代 |
| 行動原生 App、離線存取 | — | RWD 網頁已涵蓋 |
| 計費/訂閱、多組織多租戶 | — | 內部單一組織 |

---

## 15. 功能總覽表

| 編號 | 名稱 | 優先級 |
|---|---|---|
| F-ORG-01 | 單一工作區 | Must |
| F-ORG-02 | Space 管理 | Must |
| F-ORG-03 | Collection 分組 | Should |
| F-ORG-04 | Space 封存與刪除 | Should |
| F-ORG-05 | Space 範本 | Could |
| F-ORG-06 | Space 釘選頁面 | Should |
| F-PAGE-01 | 頁面樹 | Must |
| F-PAGE-02 | 頁面 CRUD | Must |
| F-PAGE-03 | 固定連結與 Slug | Must |
| F-PAGE-04 | 群組/外部連結節點 | Should |
| F-PAGE-05 | 頁面移動與複製 | Should |
| F-PAGE-06 | 回收桶 | Should |
| F-PAGE-07 | 頁面中繼資料 | Could |
| F-PAGE-08 | 死鏈處理 | Should |
| F-EDIT-01 | 區塊式 WYSIWYG 編輯器 | Must |
| F-EDIT-02 | Slash 指令選單 | Must |
| F-EDIT-03 | 基本文字區塊與行內格式 | Must |
| F-EDIT-04 | 清單區塊 | Must |
| F-EDIT-05 | Markdown 快捷輸入與貼上 | Must |
| F-EDIT-06 | 程式碼區塊 | Must |
| F-EDIT-07 | 表格區塊 | Must |
| F-EDIT-08 | 提示區塊 | Must |
| F-EDIT-09 | 圖片區塊 | Must |
| F-EDIT-10 | 檔案附件區塊 | Must |
| F-EDIT-11 | 引用與分隔線 | Must |
| F-EDIT-12 | 頁面連結與 @Mention | Should |
| F-EDIT-13 | Tabs/摺疊/步驟區塊 | Should |
| F-EDIT-14 | Mermaid 圖表 | Should |
| F-EDIT-15 | 內嵌 Embed | Should |
| F-EDIT-16 | 數學公式 | Could |
| F-EDIT-17 | 多欄版面 | Could |
| F-EDIT-18 | 可重用內容 | Could |
| F-EDIT-19 | 頁內目錄 TOC | Should |
| F-COLLAB-01 | 編輯鎖與衝突防護 | Must |
| F-COLLAB-02 | 頁面留言 | Should |
| F-COLLAB-03 | 變更請求 | Should |
| F-COLLAB-04 | 行內評論 | Could |
| F-COLLAB-05 | 即時多人共編 | Won't |
| F-VER-01 | 自動版本快照 | Must |
| F-VER-02 | 版本歷史檢視 | Must |
| F-VER-03 | 版本還原 | Must |
| F-VER-04 | 版本差異比較 | Should |
| F-VER-05 | Git Sync | Won't |
| F-SEARCH-01 | 全文搜尋（中文分詞） | Must |
| F-SEARCH-02 | 快速開啟面板 Cmd+K | Must |
| F-SEARCH-03 | 搜尋過濾器 | Should |
| F-AI-01 | LLM Provider 抽象層 | Must |
| F-AI-02 | Embedding Provider 抽象層 | Must |
| F-AI-03 | 內容嵌入管線 | Must |
| F-AI-04 | RAG 知識問答（附引用） | Must |
| F-AI-05 | 引用跳轉 | Must |
| F-AI-06 | 語意搜尋 | Must |
| F-AI-07 | 多輪問答與歷史 | Should |
| F-AI-08 | 寫作輔助 | Should |
| F-AI-09 | AI 生成頁面初稿 | Could |
| F-AI-10 | 頁面摘要/本頁問答 | Could |
| F-AI-11 | AI 用量治理 | Should |
| F-AI-12 | 回答回饋 | Could |
| F-AI-13 | 自主 AI Agent | Won't |
| F-SEC-01 | 本地帳號認證 | Must |
| F-SEC-02 | Session 管理 | Must |
| F-SEC-03 | OIDC/SSO 介面預留 | Must（整合本身 Won't） |
| F-SEC-04 | 系統角色 | Must |
| F-SEC-05 | Space 層級權限（四級角色＋三態可見性） | Must |
| F-SEC-06 | 使用者群組 | Should |
| F-SEC-07 | 稽核日誌 | Must（C8 升級） |
| F-SEC-08 | 傳輸與檔案安全 | Must |
| F-SEC-09 | 2FA | Won't |
| F-SEC-10 | 權限申請（403 申請存取） | Could |
| F-PUB-01 | 閱讀模式（內部發佈） | Must |
| F-PUB-02 | 頁面連結分享 | Must |
| F-PUB-03 | Space 首頁與瀏覽入口 | Must |
| F-PUB-04 | 對外公開發佈 | Won't |
| F-PUB-05 | 免登入分享連結 | Won't |
| F-IE-01 | Markdown 匯入 | Must |
| F-IE-02 | Markdown 匯出 | Should |
| F-IE-03 | Word/HTML/Confluence 匯入 | Could |
| F-IE-04 | PDF 匯出 | Could |
| F-IE-05 | 系統備份匯出 | Must（C8 升級） |
| F-NOTIF-01 | 站內通知中心 | Should |
| F-NOTIF-02 | Email 通知 | Could |
| F-NOTIF-03 | 訂閱更新 | Could |
| F-ADMIN-01 | 使用者管理 | Must |
| F-ADMIN-02 | 群組管理 | Should |
| F-ADMIN-03 | 系統設定外部化 | Must |
| F-ADMIN-04 | AI 設定與用量頁 | Should |
| F-ADMIN-05 | 稽核日誌檢視 | Should |
| F-ADMIN-06 | 內容分析 | Could |
| F-ADMIN-07 | 附件治理與儲存用量 | Should |
| F-API-01 | REST API | Should |
| F-API-02 | API Token | Should |
| F-API-03 | Webhooks | Could |
| F-API-04 | MCP Server | Could |
| F-API-05 | 整合市集 | Won't |

統計（C12 依上表逐項重算）：**Must 42、Should 28、Could 17、Won't 7（共 94 項）**。

> 統計勘誤沿革：v1.0 尾註「Must 34、Should 25、Could 15、Won't 8（共 82）」為誤植；v1.0 總覽表實際為 Must 40、Should 27、Could 16、Won't 7（共 90）。v1.1 修訂（C8 兩項 Should→Must：F-SEC-07、F-IE-05；新增 F-ORG-06、F-PAGE-08、F-ADMIN-07 三項 Should 與 F-SEC-10 一項 Could）後為上列數字。
>
> 分類明細：Must 42 = F-ORG 2＋F-PAGE 3＋F-EDIT 11＋F-COLLAB 1＋F-VER 3＋F-SEARCH 2＋F-AI 6＋F-SEC 7＋F-PUB 3＋F-IE 2＋F-ADMIN 2；Should 28 = F-ORG 3＋F-PAGE 4＋F-EDIT 5＋F-COLLAB 2＋F-VER 1＋F-SEARCH 1＋F-AI 3＋F-SEC 1＋F-IE 1＋F-NOTIF 1＋F-ADMIN 4＋F-API 2；Could 17 = F-ORG 1＋F-PAGE 1＋F-EDIT 3＋F-COLLAB 1＋F-AI 3＋F-SEC 1＋F-IE 2＋F-NOTIF 2＋F-ADMIN 1＋F-API 2；Won't 7 = F-COLLAB-05、F-VER-05、F-AI-13、F-SEC-09、F-PUB-04、F-PUB-05、F-API-05。

---

### Critical Files for Implementation
（repo 目前為空；以下為依本規格書實作時最關鍵的規劃檔案路徑；ORM 統一採 Drizzle，C9 決議）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/docs/specs/functional-requirements.md（本規格書落地位置，作為後續 issue 拆解依據）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/lib/db/schema.ts（Drizzle 資料模型：org/space/page/revision/permission/chunk 向量表，含 pages 鎖欄位、page_slug_history、groups/group_members、space_pinned_pages、page_visits、ai_conversations/ai_messages/ai_usage 等 Phase 1 一次補齊的表）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/drizzle/（Drizzle migration 檔案，含 pgvector/tsvector/中文分詞相關 DDL）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/lib/ai/llm-provider.ts（F-AI-01 LLM Provider 抽象層介面與 adapters）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/lib/ai/embedding-provider.ts（F-AI-02 Embedding 抽象層與重嵌管線入口）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/lib/auth/index.ts（F-SEC-01～05 認證與授權核心，預留 OIDC provider 插槽）
