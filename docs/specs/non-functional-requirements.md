# JetBook — 非功能需求（NFR）規格（修訂版）

> **文件狀態**：已套用完整性審查修正（C8、C10）。
>
> **效能目標唯一來源（C10）**：本文件的所有數字目標（延遲、容量、可用率、RPO/RTO 等）為全專案**唯一權威來源**。功能需求規格（functional-requirements.md）與 UI/UX 設計規格（ui-design.md）中出現的效能數字一律視為對本表的引用；若有出入，以本表為準並回頭修正該文件。具體對齊結果：搜尋即時建議（typeahead）統一為 **P95 < 200ms**、AI 首 token（TTFT）統一為 **P95 < 4s**、embedding 索引可檢索延遲統一為 **P95 < 60s**。

優先級定義：**P0**＝上線前必須達成、**P1**＝上線後三個月內達成、**P2**＝長期目標。目標值以公司內網環境（同機房、低延遲網路）、初期單節點部署為前提。

## A.1 效能（PERF）

| 編號 | 需求 | 目標值 | 優先級 |
|---|---|---|---|
| NFR-PERF-01 | 頁面載入（文件閱讀頁） | 內網環境 TTFB P95 < 500ms；LCP P75 < 2.5s；文件頁走 RSC + streaming render | P0 |
| NFR-PERF-02 | 關鍵字搜尋延遲 | PG full-text（含中文斷詞）P95 < 500ms；輸入即時建議（typeahead）P95 < 200ms | P0 |
| NFR-PERF-03 | 語意／混合搜尋延遲 | 向量 + 全文 hybrid 檢索（含權限過濾）P95 < 1.5s（不含 LLM 生成）；驗收需以接近真實規模的合成資料做基準測試（含高選擇性權限過濾情境，見架構文件 B.7 的 R4 降險措施） | P1 |
| NFR-PERF-04 | 編輯器輸入延遲 | 按鍵到畫面回饋 < 50ms（TipTap 為 client-side，主要約束是避免在 keystroke path 做同步網路請求）；autosave 以 ≥ 2s debounce 非同步送出 | P0 |
| NFR-PERF-05 | AI 回應串流 | 送出問題到第一個 token（TTFT）P95 < 4s（含檢索）；之後以 SSE 串流逐 token 呈現，不允許整段等待 | P0 |
| NFR-PERF-06 | 附件下載 | 50MB 檔案在內網 10s 內開始下載（streaming response，不整檔載入記憶體） | P1 |
| NFR-PERF-07 | Embedding 索引延遲 | 頁面儲存後至可被語意搜尋 P95 < 60s（非同步 job） | P1 |

## A.2 容量與擴展性（CAP）

| 編號 | 需求 | 目標值 | 優先級 |
|---|---|---|---|
| NFR-CAP-01 | 使用者數 | 註冊使用者 500 人；並發活躍 100 人（尖峰） | P0 |
| NFR-CAP-02 | 文件量 | 10 萬頁、每頁平均 50 個版本快照不影響上述效能目標；資料庫設計需可承載 100 萬 chunk 向量（pgvector HNSW） | P0 |
| NFR-CAP-03 | 附件 | 單檔上限 50MB（可設定）；總量首年 500GB；儲存層走 StorageProvider 抽象，可換 S3/MinIO 水平擴充 | P0 |
| NFR-CAP-04 | 水平擴展準備 | Web 層 stateless（session 存 DB、檔案不落本機臨時目錄依賴）、background worker 可獨立擴數量 —— 為 K8s 遷移鋪路 | P1 |

## A.3 可用性與備援（AVAIL）

| 編號 | 需求 | 目標值 | 優先級 |
|---|---|---|---|
| NFR-AVAIL-01 | 服務可用性 | 上班時段（08:00–19:00）月可用率 ≥ 99.5%；非上班時段允許維護窗口 | P0 |
| NFR-AVAIL-02 | 優雅降級 | LLM provider 不可用時，搜尋／閱讀／編輯功能不受影響（AI 功能顯示明確錯誤而非整站故障） | P0 |
| NFR-AVAIL-03 | 重啟恢復 | 單容器 crash 後 `restart: always` 自動拉起，恢復時間 < 2 分鐘；編輯中內容因 autosave 損失 ≤ 30 秒 | P0 |
| NFR-AVAIL-04 | 排隊任務不遺失 | background job（embedding、匯出、匯入）持久化於 PostgreSQL（pg-boss），worker 重啟後續跑 | P1 |

## A.4 安全（SEC）

| 編號 | 需求 | 目標值 | 優先級 |
|---|---|---|---|
| NFR-SEC-01 | OWASP | 對齊 OWASP Top 10：所有輸入以 Zod 驗證、ORM 參數化查詢防 SQL injection、編輯器內容經 sanitize 後渲染防 stored XSS、上線前跑一次 OWASP ZAP baseline scan | P0 |
| NFR-SEC-02 | 密碼儲存 | Argon2id（memory ≥ 64MB、iterations ≥ 3）；密碼政策：長度 ≥ 10、封鎖常見弱密碼 | P0 |
| NFR-SEC-03 | Session | 隨機 256-bit token（僅存 SHA-256 hash 於 DB）；Cookie `HttpOnly; Secure; SameSite=Lax`；閒置逾時 7 天、絕對逾時 30 天；登出即刻失效；換密碼撤銷所有 session | P0 |
| NFR-SEC-04 | 權限模型 | org / space / page 三層 RBAC（space 層四級角色：admin / editor / commenter / viewer），**預設拒絕**；所有資料存取在 server 端集中檢查（見架構文件 B.6），前端隱藏僅是 UX 不是防線 | P0 |
| NFR-SEC-05 | RAG 權限隔離 | AI 檢索**只能**命中使用者可讀頁面（SQL 層 join 過濾，非事後過濾）；此項列為出貨阻斷條件並有自動化測試覆蓋 | P0 |
| NFR-SEC-06 | Audit log | 登入/登出/失敗登入、權限變更、頁面建立/修改/刪除/搬移、附件上傳/下載、AI 問答查詢皆留審計（who/what/when/ip）；保留 ≥ 1 年；append-only。**（C8）本項維持 P0；對應功能需求 F-SEC-07（稽核日誌）已同步升為 Must**——實作成本低、風險高，不延後 | P0 |
| NFR-SEC-07 | API rate limit | 登入端點 5 次/分/IP（失敗鎖定遞增延遲）；AI 端點 20 次/分/使用者；一般 API 300 次/分/使用者；回 429 + `Retry-After` | P1 |
| NFR-SEC-08 | 附件安全 | 上傳白名單 MIME + 副檔名雙重驗證、檔名重寫為 UUID、下載加 `Content-Disposition` 與正確 `Content-Type`（防 HTML 附件 XSS）；ClamAV 掃描 | P1（ClamAV 為 P2） |
| NFR-SEC-09 | CSRF / Headers | Server Actions 依賴 Next.js 內建 origin 檢查；自訂 route handler 的 mutation 驗證 Origin；設定 CSP、`X-Content-Type-Options`、`Referrer-Policy` | P1 |
| NFR-SEC-10 | 傳輸加密 | 內網亦全程 HTTPS（reverse proxy 終結 TLS，公司內部 CA 或自簽） | P0 |

## A.5 資料保護與備份（DATA）

> **（C8）本節 NFR-DATA-01～03 維持 P0；對應功能需求 F-IE-05（備份）已同步升為 Must。**備份與稽核同屬「實作成本低、缺席風險極高」項目，不因排程壓力延後。

| 編號 | 需求 | 目標值 | 優先級 |
|---|---|---|---|
| NFR-DATA-01 | RPO | ≤ 1 小時（pg_dump 每日全備 + WAL archiving 連續歸檔） | P0 |
| NFR-DATA-02 | RTO | ≤ 4 小時（含重建容器 + 還原 DB + 還原附件） | P0 |
| NFR-DATA-03 | 備份策略 | DB：每日全備保留 30 天、WAL 保留 7 天；附件 volume：每日 rsync/restic 增量至異機；備份存放於**不同實體主機**。DB dump 與附件備份時間點不一致的視窗需在還原 runbook 中聲明可接受範圍 | P0 |
| NFR-DATA-04 | 還原演練 | 每季一次實際還原演練並記錄結果 | P1 |
| NFR-DATA-05 | 軟刪除 | 頁面刪除進垃圾桶保留 30 天可還原；版本歷史不可被一般使用者銷毀 | P1 |

## A.6 可維護性（MAINT）

| 編號 | 需求 | 目標值 | 優先級 |
|---|---|---|---|
| NFR-MAINT-01 | 測試覆蓋 | 核心模組（權限檢查、RAG 權限過濾、樹操作、版本快照、編輯鎖）行覆蓋率 ≥ 80%；整體 ≥ 60%；權限相關必有整合測試；「雙人同時編輯」列入 Playwright E2E 必測情境（R5） | P0 |
| NFR-MAINT-02 | Lint / Format | ESLint（typescript-eslint）+ Prettier，CI 強制；`tsc --noEmit` 零錯誤；禁用 `any` 於權限與 auth 模組 | P0 |
| NFR-MAINT-03 | CI | 每個 PR 跑 lint + typecheck + unit test + build，全綠才可 merge；main 分支自動建 Docker image | P0 |
| NFR-MAINT-04 | DB migration | 所有 schema 變更走版本化 migration（Drizzle Kit），禁止手改線上 schema | P0 |
| NFR-MAINT-05 | 設定外部化 | 所有環境差異（DB、LLM provider、儲存路徑、密鑰）只透過環境變數注入，啟動時以 Zod schema 驗證 env，缺漏即 fail-fast（12-factor） | P0 |

## A.7 可觀測性（OBS）

| 編號 | 需求 | 目標值 | 優先級 |
|---|---|---|---|
| NFR-OBS-01 | 結構化日誌 | pino 輸出 JSON 至 stdout（12-factor）；每請求帶 request-id；錯誤含 stack；不得記錄密碼/token/文件全文 | P0 |
| NFR-OBS-02 | Health check | `/api/healthz`（liveness，不碰 DB）、`/api/readyz`（readiness，驗 DB 連線）—— 供 Compose healthcheck 與未來 K8s probe 直接沿用 | P0 |
| NFR-OBS-03 | Metrics | `/api/metrics` 暴露 Prometheus 格式：HTTP 延遲/狀態碼、job 佇列深度、LLM 呼叫延遲/token 用量/費用估算、搜尋延遲 | P1 |
| NFR-OBS-04 | LLM 用量追蹤 | 每次 LLM 呼叫記錄 model、input/output tokens、latency、使用者（入 audit/metrics），供成本與濫用監控 | P1 |

## A.8 相容性（COMPAT）

| 編號 | 需求 | 目標值 | 優先級 |
|---|---|---|---|
| NFR-COMPAT-01 | 瀏覽器 | Chrome / Edge 最近 2 個大版；Firefox、Safari 最近 2 個大版；不支援 IE；行動瀏覽器可閱讀（RWD），編輯以桌面為主 | P0 |

## A.9 國際化（I18N）

| 編號 | 需求 | 目標值 | 優先級 |
|---|---|---|---|
| NFR-I18N-01 | 預設語系 | UI 預設繁體中文（zh-TW）；所有 UI 字串經 i18n 框架（next-intl）外部化，**零硬編碼字串**（ESLint rule 檢查） | P0 |
| NFR-I18N-02 | 多語預留 | 訊息檔結構支援新增 en 等語系；日期/數字以 `Intl` API 格式化；DB 一律存 UTC | P1 |
| NFR-I18N-03 | 中文搜尋 | 全文搜尋必須正確處理中文斷詞（zhparser 或 pgroonga，由 M0 spike 定案，見架構文件 B.7 與 ADR-007），以「捷揚光電」能搜到「捷揚」相關內容為驗收案例之一 | P0 |

## A.10 合規（COMP）——內部資料不外流

| 編號 | 需求 | 目標值 | 優先級 |
|---|---|---|---|
| NFR-COMP-01 | LLM 可全面本地化 | 架構上 chat 與 embedding provider 均可切換為公司內部 OpenAI-compatible endpoint（Ollama/vLLM），**切換僅需改環境變數，不改程式碼** | P0 |
| NFR-COMP-02 | 外呼盤點 | 系統對外網路呼叫僅限：LLM API、embedding API（前期，若採外部服務）；文件化清單，切換 local 後可達成零外呼；前期使用 Claude API 期間以 TLS 傳輸並知會使用者（Anthropic API 資料不用於訓練）。embedding 依 ADR-005 自 day-1 採 local BGE-M3，實際外呼僅剩 chat LLM | P0 |
| NFR-COMP-03 | 敏感空間排除 AI | Space 層級可設定「排除於 AI 索引」旗標（`ai_indexing_enabled`），該空間內容永不送往任何 LLM/embedding API | P1 |
