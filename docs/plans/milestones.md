# JetBook Milestones 總覽

- 文件版本：v1.1（已套用完整性審查修正：C8 稽核/備份升 Must/P0；新增 task B-08（M1）、C-13/M-03（M3））
- 依據：功能需求規格書 v1.1、NFR 與系統架構設計、UI/UX 設計規格書 v1.1、`docs/design/review-report.md`
- Task 明細見 `docs/plans/issue-plan.md`；依賴與排程見 `docs/plans/dependency-map.md`

## 總表

| # | 名稱 | 目標（Definition of Done） | 包含功能編號 | 規模 |
|---|---|---|---|---|
| **M0** | 專案骨架與基礎設施 | repo 可 build、可 `docker compose up`、CI 全綠、設計 token 與核心 UI 元件就緒、中文斷詞方案定案。無使用者可見功能 | F-ADMIN-03（設定外部化基礎）；NFR-MAINT-02/03/04/05、NFR-OBS-01/02、NFR-I18N-01 基礎；F-SEARCH-01 前置 spike | **S** |
| **M1** | MVP — 可用的內部知識庫 | 員工可登入 → 建 Space → 用編輯器寫文件（Must 區塊全數）→ 閱讀模式瀏覽 → 中文全文搜尋；管理者可管使用者與權限；備份機制上線。**此 milestone 完成即可內部上線** | F-ORG-01/02、F-PAGE-01/02/03、F-EDIT-01~11、F-EDIT-19、F-COLLAB-01、F-VER-01/02/03、F-SEARCH-01/02、F-SEC-01/02/03(預留)/04/05/07(寫入)/08、F-PUB-01/02/03、F-ADMIN-01/03；NFR-DATA-01~03、NFR-SEC 全部 P0 | **L** |
| **M2** | AI 核心 — RAG 問答與語意搜尋 | LLM/Embedding 抽象層可切換 provider；內容自動嵌入索引；RAG 問答附引用、可跳轉；語意搜尋進 Cmd+K；Markdown 匯入可搬遷舊文件餵 RAG；RAG 權限隔離測試通過（出貨阻斷） | F-AI-01~06、F-AI-11(rate limit 部分)、F-IE-01；NFR-SEC-05、NFR-PERF-05/07、NFR-COMP-01/02/03 | **M** |
| **M3** | 協作與治理完善 | 留言/通知/群組/稽核檢視/版本 diff/回收桶/匯出/寫作輔助/多輪問答/AI 治理後台/metrics 上線；死鏈標示（G5）與附件 GC（G6）補齊 | F-ORG-03/04、F-PAGE-04/05/06、F-EDIT-12/13/14/15、F-COLLAB-02、F-VER-04、F-SEARCH-03、F-AI-07/08/11、F-SEC-06/07(檢視)、F-IE-02/05、F-NOTIF-01、F-ADMIN-02/04/05；NFR-OBS-03/04 | **M** |
| **M4** | 進階選配（Backlog，M3 結束前再拆 task） | 依實際使用回饋擇項投入 | F-COLLAB-03(變更請求)、F-COLLAB-04、F-API-01/02/03/04、F-IE-03/04、F-EDIT-16/17/18、F-ORG-05、F-PAGE-07、F-NOTIF-02/03、F-ADMIN-06、F-AI-09/10/12 | **S–M（彈性）** |

## 各 Milestone Definition of Done 細目

### M0 專案骨架與基礎設施（規模 S）

**DoD**：
- `next build` 成功、lint/typecheck 零錯誤，standalone 產物可獨立啟動（A-01）
- `docker compose up` 起 proxy/web/db 全部服務；秘密不入 repo（A-02、A-03）
- Drizzle migration 工作流可套用至 compose DB；CI 驗證 schema 一致（A-04）
- `/api/healthz`、`/api/readyz` 與 pino 結構化日誌就緒（A-05）
- CI 全綠才可 merge；main push 產出可部署 image（A-06）
- 設計 token（雙模式 CSS variables）、self-host 字型、核心 UI 元件第一批就緒（A-07、A-08）
- next-intl i18n 骨架，UI 字串零硬編碼（A-09）
- **中文全文檢索選型 spike 定案（zhparser vs pgroonga），產出 ADR 並回寫 db image（A-10，全案最早去風險項）**

包含 tasks：A-01 ~ A-10（10 項）

### M1 MVP — 可用的內部知識庫（規模 L）

**DoD**：
- 認證：登入/登出、防暴力破解、忘記密碼 Email 重設、OIDC 預留、路由保護（B-01/B-02/B-04/B-05/B-06）
- 授權：`lib/authz` 唯一權限入口＋角色矩陣測試（B-03）；Space 權限管理 UI（C-07）
- 稽核日誌寫入（**已升 Must/P0，審查 C8**）（B-07）
- 個人設定頁：密碼變更/外觀/通知偏好（**新增 B-08，審查 G7**）
- Space/頁面樹：CRUD、拖曳排序、slug＋301、Dashboard（C-01~C-06；schema 一次補齊，審查 C3/C4/C5/G1/G8/G9/G10）
- 編輯器：TipTap Must 區塊全數＋autosave 儲存管線＋**軟性編輯鎖（審查 C1 決議）**（D-01~D-10）
- 檔案：StorageProvider＋上傳/下載權限保護（M-01/M-02）
- 版本：自動快照/檢視/還原（E-01~E-03）
- 搜尋：中文全文搜尋＋Cmd+K（F-01/F-02）
- 閱讀：App Shell 三欄、閱讀頁、深色模式、錯誤頁、分享連結（G-01~G-05）
- 後台：使用者管理、系統設定健康檢查頁（L-01/L-02）
- 品質：權限整合測試基建（N-01）、**E2E 冒煙流程全綠＝MVP 出貨閘門（N-02，含雙人編輯鎖情境）**
- 備份機制與還原 runbook（**已升 Must/P0，審查 C8**）（N-03）

包含 tasks：B-01~B-08、C-01~C-07、D-01~D-10、M-01/M-02、E-01~E-03、F-01/F-02、G-01~G-05、L-01/L-02、N-01/N-02/N-03（42 項）

### M2 AI 核心 — RAG 問答與語意搜尋（規模 M）

**DoD**：
- pg-boss 佇列與 worker 容器（H-01）
- LLM Provider 抽象層＋Anthropic＋OpenAI-compatible 實作，env 切換不改碼（H-02/H-03）
- EmbeddingProvider＋BGE-M3（1024 維，day-1 local）（H-04）
- Chunker（heading 切塊、block 持久 id 錨點）＋增量索引管線，更新後 60s 內可語意檢索（H-05/H-06）
- 全庫重嵌 job＋AI 索引排除；維度變更四步 migration 流程文件化（審查 G4）（H-07）
- Hybrid Retriever（權限 SQL JOIN 過濾）→ RAG 問答 SSE（引用跳轉）→ AI 抽屜 UI → 語意搜尋進 Cmd+K（I-01~I-05）
- AI rate limit 與用量記錄（I-06）
- Markdown 匯入（單檔＋zip 批次，含 zip 安全，審查 G2）讓 RAG 驗收有真實語料（J-01/J-02）
- **N-04 RAG 權限隔離自動化測試通過＝M2 出貨阻斷閘門**

包含 tasks：H-01~H-07、I-01~I-06、J-01/J-02、N-04（16 項）

### M3 協作與治理完善（規模 M）

**DoD**：
- 協作：頁面留言、站內通知中心、使用者群組（K-01~K-03）
- 結構補強：回收桶、Collection、跨 Space 移動、群組/外部連結節點、Space 封存（C-08~C-12）
- **死鏈標示與回收桶還原入口（新增 C-13，審查 G5）**
- **孤兒附件 GC job 與儲存用量統計（新增 M-03，審查 G6）**
- 編輯器進階：頁面連結/@mention、Tabs/摺疊/Stepper、Mermaid、Embed 白名單（D-11~D-14）
- 版本 diff（中文字詞級）（E-04）；搜尋結果頁與過濾器（F-03）
- AI 延伸：多輪對話、寫作輔助、quota 治理（I-07~I-09）
- 後台：AI 設定與用量頁（**AI 設定唯讀化，審查 C6**）、稽核日誌檢視（L-03/L-04）
- Prometheus metrics（N-05）
- Markdown 匯出（J-03）

包含 tasks：C-08~C-13、D-11~D-14、E-04、F-03、I-07~I-09、J-03、K-01~K-03、L-03/L-04、M-03、N-05（23 項）

### M4 進階選配（Backlog）

M3 結束前依實際使用回饋再拆 task。候選項目（詳見 issue-plan §M4 Backlog 彙總）：

| 功能編號 | 名稱 | 原優先級 |
|---|---|---|
| F-COLLAB-03 | 變更請求（Change Request，v1.x 首要；schema 已預留設計，審查 G10） | Should |
| F-COLLAB-04 | 行內評論 | Could |
| F-API-01 | REST API | Should |
| F-API-02 | API Token | Should |
| F-API-03 | Webhooks | Could |
| F-API-04 | MCP Server | Could |
| F-IE-03 | Word/HTML/Confluence 匯入 | Could |
| F-IE-04 | PDF 匯出 | Could |
| F-EDIT-16 | 數學公式區塊（KaTeX） | Could |
| F-EDIT-17 | 多欄版面（Columns） | Could |
| F-EDIT-18 | 可重用內容（Snippets） | Could |
| F-ORG-05 | Space 範本 | Could |
| F-PAGE-07 | 頁面中繼資料 | Could |
| F-NOTIF-02 | Email 通知 | Could |
| F-NOTIF-03 | 訂閱頁面/Space 更新 | Could |
| F-ADMIN-06 | 內容分析（含死鏈報表 v1.x，審查 G5） | Could |
| F-AI-09 | AI 生成頁面草稿 | Could |
| F-AI-10 | 頁面摘要/本頁問答 | Could |
| F-AI-12 | 回答回饋（含 chunk 快照，審查 G3） | Could |

## 兩道出貨閘門

1. **N-02（M1）**：Playwright E2E 冒煙流程全綠（登入→建 Space→建頁→編輯（含圖片）→閱讀→搜尋→權限隔離→雙人編輯鎖）才可內部上線。
2. **N-04（M2）**：RAG 權限隔離自動化測試通過（私有 space／`ai_indexing_enabled=false` 內容在任何情境下不得出現於檢索結果、prompt context 或引用）才可開放 AI 功能。
