# constraints.md — JetBook 專案約束

實作任何 issue 前必讀。與程式碼衝突時，以本檔為準修正程式碼；要改約束本身，必須先開 ADR 討論並更新 `ARCHITECTURE_DECISIONS.md`。

## 1. 產品約束

- **技術棧**：Next.js（App Router）+ TypeScript **strict** 全端 web 應用；`output: standalone`；同一 codebase 產出 web（`next start`）與 worker（`node worker.js`）兩個 entrypoint。
- **資料庫**：PostgreSQL 16 + pgvector（HNSW）為唯一資料庫與唯一持久狀態來源；中文全文檢索 extension（zhparser vs pgroonga）由 M0 A-10 spike 定案。
- **部署**：Docker Compose（proxy / web / worker / db / backup），12-factor；設計必須可平移至 K8s，禁止引入破壞 stateless 的機制。
- **語系**：繁體中文（zh-TW）為預設與第一優先；i18n 用 next-intl，新增語系只需加訊息 JSON。
- **編輯模式（v1）**：直接編輯＋autosave＋自動版本快照；**無**草稿／發布流程（C2）。防衝突：軟性編輯鎖＋樂觀版本檢查（C1）。
- **Won't for v1**：即時共編（CRDT）、Git Sync、對外公開發佈、2FA、整合市集、離線存取、多租戶——不得順手實作。

## 2. 安全約束（違反＝出貨阻斷）

- 密碼雜湊只用 **Argon2id**（`@node-rs/argon2`）。
- **Session 存 DB**（token 只存 sha256 hash、有效期與 last_active 管理）；不用 JWT 承載 session 狀態。
- **權限預設拒絕**（deny by default）：未明確授權即無權；`admin` / `member` 組織角色＋Space 層級授權。
- **RAG 權限隔離為出貨阻斷**：所有向量／hybrid 檢索必須在 SQL 層 join 權限過濾；N-04 自動化隔離測試通過前不得開放任何 AI 功能。
- **Secrets 不入 repo**：實值只存 `.env`（不 commit）；`.env.example` 佔位範本進 repo；image、log、錯誤訊息不得洩漏密鑰。
- **附件白名單**：上傳採 MIME type＋副檔名白名單與大小上限；下載一律經權限檢查的 route handler streaming，不直接暴露儲存路徑。
- **稽核與備份為 Must/P0**（C8）：audit_logs 記錄敏感操作（保留 1 年）；每日備份＋還原 runbook（RPO ≤ 1h、RTO ≤ 4h），不可延後至 M2 之後。

## 3. 架構約束

- **模組邊界**：商業邏輯一律在 `src/lib`，各模組職責固定，禁止跨界：
  | 模組 | 職責 |
  |---|---|
  | `lib/db` | Drizzle schema 與連線；**唯一** schema 定義點；migration 為獨立指令（不在 app 啟動隱式執行） |
  | `lib/auth` | session／password／OIDC（`IdentityProvider` 介面，OIDC 為其中一個實作） |
  | `lib/authz` | 權限判斷**唯一入口**（`can()`、`getAccessiblePageIds()`） |
  | `lib/llm` | LLM／Embedding Provider 抽象層；`LLM_PROVIDER=anthropic|openai-compat` 由 env 切換；tier 只有 `primary|light`，**不對呼叫端暴露 sampling 參數** |
  | `lib/rag` | chunker／indexer／retriever／answer（retriever 為最關鍵安全路徑） |
  | `lib/storage` | `StorageProvider` 介面（local → S3/MinIO 可替換） |
  | `lib/jobs` | pg-boss 佇列與 handlers（embedding、匯出、排程） |
  | `lib/content` | TipTap schema、to-markdown、sanitize（三衍生欄位管線） |
  | `lib/env.ts` | Zod 驗證環境變數、fail-fast；設定唯一入口 |
- **薄殼原則**：Server Action 與 Route Handler 只做「驗 session → 驗權限 → 呼叫 lib」；表單 mutation 用 Server Action，streaming（AI SSE）／檔案／非瀏覽器客戶端用 Route Handler。
- **佇列只用 pg-boss**（PostgreSQL `SKIP LOCKED`），不引入 Redis；排程任務（cron 類）也由 pg-boss 派發，不用本機 cron。
- **web／worker stateless**：無本機記憶體跨請求狀態（rate limit 計數器需可插拔 store）、無本機磁碟持久依賴（暫存用 `os.tmpdir` 用完即刪）、不假設單一 instance；處理 SIGTERM graceful shutdown。
- **內容格式**：TipTap JSON 為 canonical（`pages.content` jsonb）；`content_md`、`content_text` 為衍生欄位，只能在 savePage 交易內同步產生。

## 4. 相依約束

- 新增依賴必須：**寬鬆授權**（MIT / Apache-2.0 / BSD / ISC）＋ 在 PR 說明必要性與考慮過的替代方案。
- 不得引入與既定選型重複的套件：ORM＝Drizzle、佇列＝pg-boss、驗證＝Zod、UI＝Tailwind+Radix（shadcn 模式自建）、編輯器＝TipTap 2、i18n＝next-intl、log＝pino、測試＝Vitest+testcontainers+Playwright。
- 編輯器功能優先使用現成 TipTap extensions，**零自研 ProseMirror plugin**（R1 降險）。
- 禁止抄襲 GitBook 原始碼與視覺資產（允許使用 MIT/Apache 開源函式庫）。

## 5. 工作流約束

- 一次只做一個 issue；絕不直推 `main`；一律 `feature/issue-<n>-<slug>` branch → PR（含 `Fixes #<n>`）。
- 範圍膨脹或 issue 過大／不明確：立即拆成新 issue、更新 `PROJECT_STATE.md`、停止範圍外的大範圍修改。
- 不留 TODO 註解、placeholder、假 mock（除非 issue 明文要求）。
- 效能與容量數字以 `docs/specs/non-functional-requirements.md` 的 NFR 表為唯一來源（C10），其他文件不得另立數字。
