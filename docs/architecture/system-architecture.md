# JetBook — 系統架構設計（修訂版）

> **文件狀態**：已套用完整性審查修正（C1、C2、C3、C4、C5、G1、G2、G3、G4、G8、G9、G10、G11、R4、R5、R6）。
> 效能數字一律引用 `docs/specs/non-functional-requirements.md`（NFR 表為唯一來源，C10）。
> 架構層級決策的取捨記錄見 repo 根目錄 `ARCHITECTURE_DECISIONS.md`（ADR-001～ADR-010）。

## B.1 整體架構圖

```
                        ┌─────────────────────────────────────────────┐
   使用者（內網瀏覽器）   │  Reverse Proxy (Caddy/Nginx, TLS 終結)       │
        │ HTTPS          └──────────────────┬──────────────────────────┘
        ▼                                   │
┌───────────────────────────────────────────▼───────────────────────────┐
│  Next.js App (App Router, Node runtime)  ── Docker container "web"    │
│  ┌──────────────┐ ┌───────────────┐ ┌──────────────────────────────┐  │
│  │ RSC 頁面渲染  │ │ Server Actions │ │ Route Handlers               │  │
│  │ (閱讀/樹狀導覽)│ │ (表單 mutation │ │ (/api/ai/* SSE, /api/files,  │  │
│  └──────────────┘ │  /編輯鎖)      │ │  /api/search, /api/healthz)  │  │
│                   └───────────────┘ └──────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │ 共用核心層 src/lib：authz(權限) / rag / llm(Provider抽象) /      │   │
│  │ storage(StorageProvider抽象) / db(Drizzle schema)               │   │
│  └────────────────────────────────────────────────────────────────┘   │
└───────┬───────────────────────┬──────────────────────┬────────────────┘
        │ SQL                   │ enqueue (pg-boss)     │ read/write
        ▼                       ▼                       ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────┐
│ PostgreSQL 16    │   │ Worker container  │   │ 物件儲存              │
│ + pgvector(≥0.8) │◄──┤ (同 codebase、    │   │ 初期: local volume    │
│ + zhparser/      │   │  獨立 entrypoint) │   │ 介面: StorageProvider │
│   pgroonga       │   │ - embedding 索引  │   │ 未來: S3/MinIO 實作   │
│ (文件/版本/權限/  │   │ - 匯出 (md/html)  │   └──────────────────────┘
│  向量/全文/佇列)  │   │ - 匯入 (md zip)   │
└──────────────────┘   │ - 附件掃描        │
                       │ - cron 排程清理   │
                       └────────┬─────────┘
                                │ HTTPS (可全內網化)
                                ▼
                   ┌─────────────────────────────────┐
                   │ LLM Provider 抽象層              │
                   │ ├─ AnthropicProvider (前期)      │
                   │ │   @anthropic-ai/sdk           │
                   │ │   claude-sonnet-5 / haiku-4-5 │
                   │ └─ OpenAICompatProvider (後期)   │
                   │     Ollama / vLLM 內部 endpoint  │
                   │ Embedding Provider 抽象層 (同構)  │
                   └─────────────────────────────────┘
```

要點：
- **單一 image、兩種角色**：web 與 worker 用同一個 Docker image，以不同啟動命令區分（`next start` vs `node worker.js`）。K8s 遷移時直接變成兩個 Deployment。
- **佇列不引入 Redis**：pg-boss 以 PostgreSQL 實作可靠佇列（`SKIP LOCKED`），少一個有狀態元件；未來規模需要時再演進（ADR-003）。
- **所有狀態集中於 PostgreSQL + 物件儲存**，web/worker 完全 stateless。

**Worker 職責清單（含 G2 匯入與 G11 cron jobs）**：

| 類別 | Job | 說明 |
|---|---|---|
| 索引 | `embed-page` | 頁面存檔後增量重算 embedding（見 B.7） |
| 索引 | `reindex-all` | 換 embedding 模型時全量重嵌（批次＋斷點續跑＋進度回報） |
| 匯出 | `export-space` | Space 匯出 md/html zip → 通知下載 |
| 匯入 | `import-markdown` | Markdown zip 匯入（見 B.7 後「匯入管線」小節；zip bomb 上限、路徑穿越檢查） |
| 掃描 | `scan-attachment` | ClamAV 附件掃描（P2） |
| cron | `purge-trash` | 回收桶頁面逾 30 天永久清除（F-PAGE-06） |
| cron | `purge-deleted-spaces` | 軟刪 Space 逾保留期永久清除（F-ORG-04） |
| cron | `cleanup-sessions` | 刪除過期 `sessions` 列 |
| cron | `maintain-audit-partitions` | `audit_logs` 月分區預建與逾一年分區歸檔 |
| cron | `prune-page-visits` | `page_visits` 每人僅保留最近 N 筆（G9） |

pg-boss 原生支援 cron 排程與分散式鎖派發，多 worker 副本下同一 cron job 不會重複執行。

## B.2 Next.js 專案結構

```
/
├── docker-compose.yml
├── Dockerfile                     # multi-stage, output: standalone
├── drizzle/                       # migration 檔
├── messages/zh-TW.json            # i18n 訊息（next-intl）
├── src/
│   ├── app/
│   │   ├── (auth)/login/          # 登入頁（無側欄 layout）
│   │   ├── (app)/                 # 登入後主應用 layout（側欄樹 + 頂欄）
│   │   │   ├── page.tsx           # 首頁/儀表板
│   │   │   ├── s/[spaceSlug]/
│   │   │   │   ├── [pageSlug]/page.tsx     # 文件閱讀（RSC；含 slug 301 resolver）
│   │   │   │   └── [pageSlug]/edit/page.tsx# 編輯器（client）
│   │   │   ├── search/page.tsx
│   │   │   ├── ask/page.tsx       # AI 知識問答（抽屜之深連結全螢幕檢視）
│   │   │   └── admin/             # 使用者/群組/空間/審計管理
│   │   └── api/
│   │       ├── ai/chat/route.ts   # RAG 問答 SSE streaming（含配額檢查）
│   │       ├── ai/assist/route.ts # 寫作輔助 streaming
│   │       ├── search/route.ts    # hybrid search
│   │       ├── files/[id]/route.ts# 附件下載（權限檢查+streaming）
│   │       ├── upload/route.ts
│   │       ├── auth/oidc/[...]/route.ts  # OIDC callback（預留）
│   │       ├── healthz/route.ts  ├── readyz/route.ts  └── metrics/route.ts
│   ├── actions/                   # Server Actions（page.save、page.move、lock.acquire、comment.create…）
│   ├── components/                # UI 元件（editor/、tree/、search/…）
│   ├── lib/
│   │   ├── db/{schema.ts,index.ts}        # Drizzle
│   │   ├── auth/{session.ts,password.ts,oidc.ts}
│   │   ├── authz/permission.ts            # 唯一權限判斷入口
│   │   ├── llm/{provider.ts,anthropic.ts,openai-compat.ts,embedding.ts}
│   │   ├── rag/{chunker.ts,indexer.ts,retriever.ts,answer.ts}
│   │   ├── content/{tiptap-schema.ts,to-markdown.ts,from-markdown.ts,sanitize.ts,block-id.ts}
│   │   ├── storage/{provider.ts,local.ts,s3.ts}
│   │   ├── jobs/{queue.ts,handlers/,cron/}
│   │   └── env.ts                 # Zod 驗證環境變數
│   └── worker.ts                  # worker entrypoint
└── tests/                         # Vitest + Playwright
```

**Server Actions vs Route Handlers 使用原則**

| 情境 | 用法 |
|---|---|
| 頁面資料讀取 | RSC 內直接呼叫 lib 層（不經 HTTP 繞路） |
| 表單類 mutation（存檔、留言、搬移、權限設定、編輯鎖操作） | **Server Actions**（型別安全、免手刻 fetch；內部第一行必呼叫 authz） |
| Streaming 回應（AI SSE） | **Route Handler**（Server Action 不適合長串流） |
| 檔案上傳/下載 | **Route Handler**（binary streaming、Content-Disposition） |
| 需被非瀏覽器客戶端呼叫（未來 API token、webhook、健康檢查、metrics） | **Route Handler** |

規則：兩者都只做「驗 session → 驗權限 → 呼叫 lib 層」的薄殼，商業邏輯一律在 `src/lib`，避免邏輯散落。

## B.3 資料模型（ERD）

```
users ─┬─< sessions
       ├─< group_members >─ groups
       ├─< space_members(主體 user|group) >─ spaces ─< pages ─< page_versions
       │                        │   │            ├─< comments
       │                        │   │            ├─< page_permissions(主體 user|group)
       │                        │   │            ├─< attachments
       │                        │   │            ├─< page_embeddings
       │                        │   │            └─< page_slug_history
       │                        │   └─< space_pinned_pages
       │                        └─ collections（預留）>─ spaces.collection_id
       ├─< page_visits
       ├─< ai_conversations ─< ai_messages
       ├─< ai_usage
       ├─< notifications
       └─< audit_logs
```

關鍵表與欄位（型別以 Drizzle/PG 慣例）：

| 表 | 關鍵欄位 |
|---|---|
| `users` | id (uuid pk), email (unique), name, password_hash (nullable — OIDC 使用者可為空), org_role (`admin`\|`member`), auth_provider (`local`\|`oidc`), oidc_subject (nullable, unique), is_active, created_at |
| `sessions` | id (uuid pk), user_id fk, token_hash (unique, sha256), ip, user_agent, expires_at, last_active_at, created_at |
| `groups` | id (uuid pk), name (unique), description, created_at —— **（C5）**AD/SSO 群組映射的前置，Phase 1 即建表 |
| `group_members` | group_id fk, user_id fk, pk(group_id, user_id) |
| `spaces` | id, slug (unique), name, description, icon, **visibility (`private`＝僅成員 \| `org_read`＝全員可讀 \| `org_write`＝全員可讀寫)（C4 三態）**, ai_indexing_enabled (bool, NFR-COMP-03), collection_id (nullable fk → collections，G10 預留), created_by, created_at, archived_at, deleted_at (軟刪，逾期由 cron 永久清除) |
| `space_members` | space_id fk, **subject_type (`user`\|`group`)（C5 主體泛化）**, subject_id (uuid — 指向 users 或 groups), role (`admin`\|`editor`\|`commenter`\|`viewer`)**（C3 四級）**, pk(space_id, subject_type, subject_id) |
| `pages` | id, space_id fk, **parent_id fk (self, nullable)**, **position (double／fractional index 排序鍵)**, slug, title, icon, content (jsonb — TipTap doc，heading/block 節點含持久 `id` attribute，R6), content_md (text — 衍生 markdown), content_text (text — 純文字，餵 tsvector), search_tsv (tsvector, GIN index), current_version_no (int — 樂觀版本檢查基準), **locked_by (uuid fk → users, nullable), locked_at (timestamptz, nullable)（C1 軟性編輯鎖）**, restricted (bool — 頁面層權限覆寫旗標), created_by, updated_by, created_at, updated_at, deleted_at (軟刪除)。**（C2）本表刻意沒有 `status`/`published_version_no` 等草稿/發布欄位**——v1 為直接編輯＋autosave＋自動版本快照，無發布閘門（ADR-010） |
| `page_versions` | id, page_id fk, version_no (int, unique with page_id), content (jsonb 完整快照), content_md, title, created_by, created_at, note (nullable，命名版本) |
| `page_slug_history` | id, space_id fk, old_slug, page_id fk, created_at；index(space_id, old_slug)——**（G1）**頁面改名/搬移時同交易寫入，支撐 301 永久導向 |
| `page_permissions` | id, page_id fk, **subject_type (`user`\|`group`\|`space_role`)（C5 主體泛化）**, subject_id, role (`editor`\|`commenter`\|`viewer`) — 頁面層覆寫（搭配 `pages.restricted` 旗標） |
| `comments` | id, page_id fk, parent_comment_id (self, nullable — 討論串), author_id, body (jsonb, 簡化版 rich text), anchor (jsonb, nullable — 行內選取範圍), resolved_at, created_at, deleted_at |
| `attachments` | id, page_id fk (nullable), space_id fk, uploader_id, file_name, mime_type, size_bytes, storage_key (StorageProvider 內的 key), sha256, scan_status (`pending`\|`clean`\|`infected`), created_at |
| `page_embeddings` | id, page_id fk, chunk_index (int), heading_path (text — 如 "安裝指南 > 前置需求"，供顯示與 context header), **block_id (text — chunk 起始 block 的持久 id，引用跳轉錨點，R6）**, chunk_text (text), embedding (vector(1024)), embedding_model (text), token_count, content_hash (text — 增量重算用), updated_at；**HNSW index (vector_cosine_ops)**；unique(page_id, chunk_index) |
| `ai_conversations` | id, user_id fk, title (輕量模型自動命名), created_at, updated_at, deleted_at ——**（G3）**對話歷史（F-AI-07） |
| `ai_messages` | id, conversation_id fk, role (`user`\|`assistant`), content (text), **citations (jsonb — 檢索 chunk 引用快照：`[{n, pageId, chunkIndex, blockId, headingPath, snippet, score}]`，供稽核與回饋分析，不受日後頁面改動影響)**, model, usage (jsonb — input/output tokens), feedback (`up`\|`down`\|null), feedback_note (nullable), created_at ——**（G3）**（F-AI-12） |
| `ai_usage` | user_id fk, date (date), chat_count (int), tokens_in (bigint), tokens_out (bigint), pk(user_id, date) ——**（G3）**per user/day 配額計數（F-AI-11）；**配額強制執行點在 `/api/ai/chat` route handler**：進入時檢查當日計數，超額回 429 |
| `page_visits` | user_id fk, page_id fk, visited_at, pk(user_id, page_id)——**（G9）**閱讀頁載入時 upsert；供 Dashboard「繼續閱讀」與 Cmd+K 空狀態；cron 每人保留最近 N 筆（預設 50） |
| `space_pinned_pages` | space_id fk, page_id fk, position (int), pk(space_id, page_id)——**（G8）**Space 首頁釘選（上限 6 於應用層強制） |
| `collections` | id, name, slug (unique), position, created_at ——**（G10）**v1 僅建表預留（Space 分組導覽），UI 於 v1.x 啟用 |
| `audit_logs` | id (bigserial), actor_id (nullable — 匿名/系統), action (text, 如 `page.update`/`auth.login_failed`/`ai.query`/`lock.takeover`), target_type, target_id, metadata (jsonb), ip, created_at；僅 INSERT，**按月分區**（cron 維護分區，G11） |
| `notifications` | id, user_id fk, type (`mention`\|`comment_reply`\|`page_updated`…), payload (jsonb), read_at, created_at |
| `org_settings` | 單列：org 名稱、預設語系、AI 功能開關、AI 每人每日配額、附件大小上限等（營運設定存 DB；環境設定一律 env，見 NFR-MAINT-05） |

**樹狀結構儲存：鄰接表（`parent_id`）＋ fractional index 排序鍵（`position`），不用 materialized path（ADR-001）。**理由：
1. 知識庫最頻繁的寫入操作是**搬移／重排**：鄰接表搬移子樹只改一列的 `parent_id`+`position`（O(1)）；materialized path 需要 UPDATE 整棵子樹的 path（大子樹搬移成本高且要在交易內鎖住）。
2. 讀取整棵 space 樹用 PG **recursive CTE**，10 萬頁規模、單 space 通常數千頁，內網延遲下毫無壓力；且側欄樹常整包載入後前端組裝，一句 `WHERE space_id = ?` 就夠。
3. 排序用 fractional indexing（插入兩節點間取中值），拖曳排序免重排兄弟節點。
4. 麵包屑（breadcrumb）用 recursive CTE 向上查即可；若成為熱點再加非正規化的 `path_cache` 欄位，屬可後補的最佳化而非架構決策。

**版本快照與 diff 策略（ADR-008）**：每次「顯性存檔」與「autosave 靜止 5 分鐘後的合併點」寫入一筆 `page_versions` **完整 JSON 快照**（非 delta）。理由：快照實作簡單、還原 O(1)、不會因 delta 鏈斷裂損壞歷史；文件 JSON 平均數十 KB，10 萬頁 × 50 版 ≈ 數百 GB 內可控，且 jsonb TOAST 自動壓縮。Diff 在**顯示時**計算：以兩版 `content_md` 做文字 diff（`diff` npm 套件）呈現，未來可升級 ProseMirror 節點級 diff。

**Slug 歷史與 301 導向（G1）**：
1. 頁面改 slug 或跨 space 搬移（F-PAGE-05）時，於**同一交易**寫入 `page_slug_history(space_id=原space, old_slug=原slug, page_id)`。
2. 路由 resolver（`s/[spaceSlug]/[pageSlug]`）解析順序：
   - 先查 `pages` 現行 slug → 命中即渲染；
   - 未命中 fallback 查 `page_slug_history`（同 space、同 old_slug 多筆時取 `created_at` 最新）→ 命中回 **HTTP 301** 至現行 URL；
   - 皆未命中 → 404。
3. 現行 slug 永遠優先於歷史記錄——若舊 slug 被新頁面重用，解析到新頁面（歷史表僅為 fallback）。
4. 內部連結以 pageId 為準（F-EDIT-12），slug 僅影響 URL；本表保障的是書籤、外部貼文與匯出文件內的舊 URL 不失效。

**變更請求（Change Request）預留設計（G10）**：v1 不實作，但為避免 v1.x 推翻版本模型，預留方向如下——草稿分支以獨立 `change_requests` 表承載（id, page_id, author_id, base_version_no, draft_content jsonb, status `open|merged|closed`, created_at），**不**在 `page_versions` 上加 branch_id 弄髒主線歷史；merge 時走與 `savePage` 相同的樂觀版本檢查路徑（base_version_no 落後即要求 rebase/重新套用），合併結果成為一筆新 `page_versions` 快照。此設計不需改動現有 `pages`/`page_versions` 任何欄位，v1 schema 不受影響。

### 編輯併發設計：軟性編輯鎖＋樂觀版本檢查（C1／R5，ADR-006）

v1 防衝突採**兩道防線**：軟性編輯鎖為主（防止同時編輯發生）、`current_version_no` 樂觀版本檢查為備援（萬一鎖失效時保證不靜默覆蓋）。即時共編（CRDT/Yjs）明列為 v1 Won't，留待 v2。

**鎖的資料表示**：`pages.locked_by`（uuid）＋ `pages.locked_at`（timestamptz）。兩欄皆 NULL 或 `locked_at` 逾閒置閾值即視為無鎖——**不需要背景程序主動釋放鎖**，過期判定內建於取鎖條件。

**參數**：心跳間隔 **30s**；閒置釋放閾值 **5 分鐘**（= 容忍連續 10 次心跳遺失，涵蓋短暫斷網）；兩值皆環境變數可調。

**狀態機**：

```
                       acquireLock 成功
        ┌──────────┐ ──────────────────────► ┌──────────────┐
        │  無鎖     │                          │ 持鎖（我）    │◄──┐
        │ locked_by │ ◄────────────────────── │ locked_by=me │───┘
        │  IS NULL  │   releaseLock（主動釋放： │              │ heartbeatLock
        │  或已逾時  │   關編輯器/切回閱讀）      └──────┬───────┘ 每 30s 續租
        └─────┬─────┘                                │          （更新 locked_at）
              │                                      │ 心跳中斷（關分頁/瀏覽器
              │ 他人 acquireLock 成功                 │ crash/斷網）且逾 5 分鐘
              ▼                                      ▼
        ┌──────────────┐                       （自動回到「無鎖」——
        │ 持鎖（他人）   │                        由下一個 acquireLock
        │ 其他人開編輯器 │                        的 WHERE 條件判定）
        │ → 唯讀＋banner│
        └──────┬───────┘
               │ Admin（org admin 或 space admin）執行 takeoverLock
               ▼
        持鎖（Admin）；原持鎖人下次心跳收到 LOCK_LOST
        → 前端降為唯讀、保留未存內容供複製，並寫 audit（lock.takeover）
```

**取鎖必須原子**——單條 UPDATE 完成「檢查＋取得」，杜絕 race：

```sql
UPDATE pages
SET    locked_by = :me, locked_at = now()
WHERE  id = :pageId
  AND (locked_by IS NULL OR locked_by = :me OR locked_at < now() - interval '5 minutes')
RETURNING locked_by;
-- 0 列被更新 = 他人持鎖中 → 回傳持鎖人資訊，前端進唯讀模式
```

心跳 `heartbeatLock` 同樣以 `WHERE locked_by = :me` 條件更新 `locked_at`；更新 0 列代表鎖已易主（被搶鎖或逾時被他人取得），回傳 `LOCK_LOST`，前端立即停止 autosave 並降為唯讀。

**與存檔管線的互動（server 端強制）**：
1. `savePage` 第一步驗證 `locked_by = 呼叫者`——沒有鎖不允許寫入（防止繞過前端直呼 action）。
2. 第二步樂觀版本檢查：請求須帶 `baseVersionNo`，與 `pages.current_version_no` 不符即回 **409 CONFLICT**，前端顯示衝突攔截畫面（檢視差異／仍要覆蓋／複製我的內容）。此為鎖失效（如 Admin 搶鎖後原持鎖人以殘留分頁強行送出）時的最後防線。
3. 版本快照 session 邊界：釋放鎖（主動或逾時）即結束一次「編輯 session」，下次取鎖後的第一個 autosave 一律新開版本快照，不與前人合併。

**E2E 驗收（R5，納入 NFR-MAINT-01）**：Playwright 必測「雙人同時編輯」情境——B 開啟 A 持鎖頁面見唯讀 banner；A 關分頁 5 分鐘後 B 可接手；Admin 搶鎖後 A 收到通知且送出被 409 攔截。

## B.4 內容格式決策

**Canonical 格式：TipTap/ProseMirror JSON 存於 `pages.content` (jsonb)。另於儲存時同步衍生 `content_md`（markdown）與 `content_text`（純文字）。（ADR-002）**

理由：
1. **無損**：TipTap 的自訂節點（callout、表格、mention、附件嵌入）在 markdown 中會失真；JSON 是編輯器的原生格式，round-trip 零損耗。
2. **協作與版本**：ProseMirror JSON 有嚴格 schema，可做節點級 diff，未來若加即時協作（Yjs）也是同一生態。
3. **衍生格式各司其職**：`content_md` 供匯出（GitBook 式 md export）與 **RAG chunking**（heading 結構清晰、LLM 對 markdown 理解最好）；`content_text` 餵 `search_tsv` 全文索引。
4. **取捨**：代價是三份資料要同步（在同一次存檔交易內由 server 端統一轉換，單一來源為 JSON，不可能不同步）；以及 JSON 綁定 TipTap schema，schema 演進需寫 migration —— 用「schema version 欄位＋讀取時 lazy upgrade」緩解。
5. 否決「markdown 為 canonical」：會迫使編輯器所有進階功能塞進 markdown 方言，行內註解 anchor、mention 等都難以穩定表達。

**Block 持久 id（R6）**：TipTap 的 heading 與 block 級節點（paragraph、codeBlock、table、callout…）一律帶持久 `id` attribute（建立時以 nanoid 產生、存入 JSON、編輯不變、複製貼上時重生避免重複）。用途：
- `page_embeddings.block_id` 記錄 chunk 起始 block 的 id，AI 引用跳轉以 `pageId + blockId` 深連結定位（渲染時 block id 輸出為 DOM `id`），**heading 改字不會斷錨點**；`heading_path` 僅供顯示與 embedding context header。
- F-EDIT-03 的 heading 錨點生成規則同步採 id-based（URL hash 用 block id，不用標題文字 slugify）。

## B.5 API 設計原則與關鍵 Endpoint

原則：
1. UI 內部操作優先 Server Actions；HTTP API 僅保留 streaming、檔案、搜尋與未來對外整合面。
2. Route handler 統一回應格式：成功 `{ data }`、失敗 `{ error: { code, message } }`＋正確 HTTP 狀態碼；錯誤碼機器可讀（`FORBIDDEN`、`RATE_LIMITED`、`CONFLICT`、`LOCKED`…）。
3. 所有入口（action 與 route）第一步 `requireSession()`、第二步 `authz` 檢查，缺一不可（見 B.6）。
4. 分頁一律 cursor-based；所有 list endpoint 有上限（≤100）。
5. 對外 API 版本化前綴 `/api/v1/`（內部 UI 用的可免）。

關鍵 endpoint / actions：

| 類別 | 介面 |
|---|---|
| Auth | `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/oidc/authorize`、`GET /api/auth/oidc/callback`（預留） |
| Spaces | actions：`createSpace`、`updateSpace`（含 visibility 三態）、`setSpaceMember`（主體 user\|group、四級角色）、`pinPage`/`unpinPage`；RSC 直讀樹 |
| Pages | actions：`createPage`、`savePage`（驗鎖＋樂觀版本檢查＋版本快照＋衍生內容同步＋enqueue embedding）、`movePage(parentId, position)`（跨 space 時寫 slug 歷史＋轉移附件歸屬）、`renamePageSlug`（寫 `page_slug_history`）、`deletePage`（軟刪）、`restoreVersion(versionNo)` |
| **編輯鎖（C1）** | actions：`acquireLock(pageId)`（原子取鎖，失敗回持鎖人資訊）、`heartbeatLock(pageId)`（30s 續租，回 `OK`\|`LOCK_LOST`）、`releaseLock(pageId)`（主動釋放）、`takeoverLock(pageId)`（僅 Admin，寫 audit 並通知原持鎖人） |
| Versions | RSC 讀 `page_versions` 列表；`GET /api/v1/pages/:id/versions/:no`（diff 資料） |
| Comments | actions：`addComment`（commenter 以上）、`resolveComment`、`deleteComment` |
| Search | `GET /api/search?q=&mode=keyword|semantic|hybrid&space=`（回傳 hit + highlight + 權限已過濾） |
| AI | `POST /api/ai/chat`（RAG 問答，SSE：`sources` 事件先送引用、`delta` 逐 token、`done` 帶 usage；進入時檢查 `ai_usage` 當日配額，超額 429；對話與引用快照落 `ai_conversations`/`ai_messages`）；`POST /api/ai/assist`（寫作輔助：續寫/改寫/摘要/翻譯，SSE）；action：`submitAiFeedback(messageId, up|down, note?)` |
| Files | `POST /api/upload`（multipart，回 attachment id）；`GET /api/files/:id`（權限檢查後 streaming） |
| Import/Export | action `exportSpace(format: md|html)` → enqueue job → 通知下載；action `importMarkdown(spaceId, uploadId)` → enqueue `import-markdown` job（G2）→ 進度查詢＋成功/失敗報告 |
| Ops | `GET /api/healthz`、`/api/readyz`、`/api/metrics` |
| Admin | actions：`createUser`、`deactivateUser`、`setOrgRole`、`createGroup`、`setGroupMembers`；RSC 讀 audit log |

## B.6 認證與授權架構

**本地帳號**
- 密碼雜湊：**Argon2id**（`@node-rs/argon2`，參數見 NFR-SEC-02）。選 Argon2id 而非 bcrypt：現代記憶體硬化演算法、OWASP 首選；bcrypt 72-byte 截斷與 GPU 抗性較弱。
- 登入失敗計數與遞增延遲（DB 記錄，防撞庫）。

**Session 策略：DB-backed opaque session（自建，參考 Lucia 模式），不用 JWT（ADR-004）。**
- 流程：登入 → 產生 256-bit random token → DB 存 `sha256(token)` → token 放 HttpOnly cookie。每請求以 hash 查 `sessions` 取 user。
- 理由：內部系統需要「即時撤銷」（離職停權必須立刻生效），stateless JWT 做不到；DB 查一次在內網規模毫無壓力；且 session 存 DB 正好滿足 web 層 stateless、K8s 多副本共用。
- Next.js 中以 `cache()` 包裝 per-request 的 session 解析避免重複查詢。

**OIDC/SSO 預留介面（接 Azure AD）**——設計為具體可插拔：
1. `users` 已含 `auth_provider` + `oidc_subject` 欄位；本地與 OIDC 使用者共用同一張表與同一套 session（**OIDC 只負責「驗明身分」，session 管理仍是自家的**，因此加 OIDC 不動任何授權邏輯）。
2. 預留 route：`/api/auth/oidc/authorize`（redirect 到 IdP）與 `/api/auth/oidc/callback`（code exchange → 以 `email`/`sub` upsert user → 建立本地 session）。實作用 `openid-client`（MIT）。
3. 設定外部化：`AUTH_OIDC_ISSUER`、`AUTH_OIDC_CLIENT_ID/SECRET`、`AUTH_OIDC_AUTO_PROVISION`（是否自動開帳號）。未設定時登入頁不顯示 SSO 按鈕。
4. `lib/auth/` 內定義 `IdentityProvider` 介面（`getAuthorizationUrl`, `handleCallback → {email, name, subject}`），Azure AD 只是其中一個實作。`groups`/`group_members` 表（C5）同時是未來 AD 群組映射的落點。

**權限矩陣：space 四級角色能力表（C3）**

| 能力 | viewer | commenter | editor | admin（space） |
|---|---|---|---|---|
| 閱讀頁面／出現在其搜尋與 RAG 結果 | ✓ | ✓ | ✓ | ✓ |
| 留言、回覆、解決自己發起的討論串 | ✗ | ✓ | ✓ | ✓ |
| 建立／編輯／搬移／刪除頁面、上傳附件 | ✗ | ✗ | ✓ | ✓ |
| 取得編輯鎖、還原版本、還原回收桶頁面 | ✗ | ✗ | ✓ | ✓ |
| 管理 space 成員與角色、space 設定（visibility、AI 索引開關）、釘選頁面 | ✗ | ✗ | ✗ | ✓ |
| 搶鎖（takeoverLock）、清空回收桶 | ✗ | ✗ | ✗ | ✓ |

（org_role=admin 隱含所有 space 的 admin 能力。）

**權限檢查實作層級**
- 單一入口：`lib/authz/permission.ts` 提供 `can(user, action, resource)` 與 `getAccessiblePageIds(userId, spaceId?)`；**禁止**在 UI 或 action 內散寫權限判斷。
- **解析順序（C4/C5 更新）**：
  1. `org_role = admin` → 全通；
  2. page `restricted = true` → 只看 `page_permissions`（主體為該 user **或使用者所屬任一 group**，取最高角色）；
  3. `space_members` 明確授權 → user 直接成員資格與**經 `group_members` join 取得的群組成員資格**合併，取最高角色；
  4. 無明確授權時看 `spaces.visibility`：`org_read` → 全員 viewer；`org_write` → 全員 editor；`private` → 拒絕；
  5. 預設拒絕。
- `getAccessiblePageIds` 的 SQL 據此組成：`space_members` 需 `LEFT JOIN group_members ON (subject_type='group' AND subject_id=group_id AND user_id=:me)` 將群組授權攤平為使用者授權，再 union visibility 為 `org_read`/`org_write` 的 space，最後套 `restricted` 頁面的 `page_permissions` 覆寫（同樣含群組主體）。
- 三個 enforcement 點：(1) Server Action / Route Handler 進入點（主防線）；(2) RSC 資料載入（決定 404/403）；(3) **RAG 檢索 SQL join**（見 B.7）。
- 批次讀取場景（樹、搜尋）以 SQL 條件（join `space_members` / `group_members` / `page_permissions`）在資料庫層過濾，避免 N+1 與遺漏。

## B.7 RAG Pipeline 詳細設計

```
存檔 → (交易內) 更新 content/content_md/tsvector → enqueue "embed-page" job
                                                          │ worker
            ┌─────────────────────────────────────────────▼─────────────┐
            │ 1. 依 heading 切 chunk（content_md，記錄起始 block_id）      │
            │ 2. content_hash 比對，僅重算變動 chunk（省 embedding 費用）  │
            │ 3. EmbeddingProvider.embed(batch)                          │
            │ 4. upsert page_embeddings（同交易刪除孤兒 chunk）            │
            └────────────────────────────────────────────────────────────┘

問答:  question ─► (Haiku: query rewrite，可選) ─► hybrid retrieval ─► (rerank 可選)
        ─► 組 prompt（chunk + 引用編號）─► Sonnet streaming ─► SSE(sources → delta → done)
```

1. **Chunking**：以 `content_md` 依 **heading 階層**切分（H1–H3 為邊界）；目標 chunk 大小 **300–500 tokens**、上限 800，超長段落再按段落二次切、相鄰 chunk 重疊約 10–15%；每個 chunk 前置 `頁面標題 > heading path` 作為 context header（提升繁中語意檢索命中）。表格/程式碼區塊不跨 chunk 切斷。**每個 chunk 記錄其起始 block 的持久 id（`block_id`，R6），引用跳轉以 `pageId + blockId` 定位，不依賴 heading 文字。**
2. **Embedding 產生時機**：頁面儲存後**非同步**（pg-boss job，2s debounce 合併連續存檔）；以 chunk `content_hash` 做增量，只重算變動部分。刪頁/取消 AI 索引時清除向量。
3. **pgvector 索引（含 R4 降險）**：`vector(1024)`＋**HNSW**（`vector_cosine_ops`，m=16, ef_construction=64）。規模與召回要求：
   - **pgvector 版本要求 ≥ 0.8**，啟用 **iterative index scan**（`hnsw.iterative_scan`）——HNSW 疊加高選擇性權限過濾（使用者只可讀少數 space）時，非疊代掃描的 top-k 會召回不足；
   - 檢索一律 **over-fetch：向量路取 k=40，過濾後保留 20** 進入融合；
   - `hnsw.ef_search` 依基準測試調校（預設 40 起跳）；
   - 1M chunk × 1024 維 float ≈ 4GB 向量＋HNSW 圖需納入 DB 記憶體預算，吃緊時評估 **`halfvec`（fp16）** 備案（體積減半、召回損失需過 golden question 評測）；
   - 以接近真實規模的合成資料做一次基準測試，納入 NFR-PERF-03 驗收。
   - `embedding_model` 欄位記錄模型名，**同維度換模型＝背景 `reindex-all` job 全量重算**（批次＋斷點續跑＋進度回報）。
4. **Embedding 維度變更流程（G4）**：pgvector 欄位維度固定，`vector(1024)` 換成不同維度模型（如 1536 維）**不是**跑 reindex job 就好，必須走四步 migration 流程：
   - **(1) Migration 新欄**：新增 `embedding_new vector(<新維度>)` 欄（或新表 `page_embeddings_v2`）並建立新 HNSW index；
   - **(2) 全量重嵌**：`reindex-all` job 以新模型批次重嵌寫入新欄（斷點續跑、進度回報進 admin UI，F-ADMIN-04）；
   - **(3) 切換**：更新 `EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` env 並部署，檢索路徑改讀新欄；切換前以 golden question 評測集驗證品質；
   - **(4) 清理**：穩定運行後以 migration 移除舊欄與舊 index。
   同維度模型族（bge-m3、voyage-3.5 皆可配置 1024 維）之間切換則只需步驟 (2)＋env 更新。
5. **檢索（hybrid）**：
   - 全文：PG `tsvector`，中文斷詞用 **zhparser 或 pgroonga（M0 spike 定案，審查傾向 pgroonga；ADR-007）**——這是繁中環境的關鍵，內建 parser 對中文無效。
   - 向量：cosine top-k（over-fetch k=40 → 過濾後 20，見上）。
   - 融合：**RRF（Reciprocal Rank Fusion）** 合併兩路結果取 top 8–12。
   - **權限過濾（安全關鍵）**：兩路查詢的 SQL 本身就 `JOIN` 可讀頁面集合（`getAccessiblePageIds` 條件化為子查詢，**含群組成員 join 與 visibility 三態**），**不做「先檢索再過濾」**——杜絕不可讀內容進入 LLM context 或 citation 的任何可能；並排除 `ai_indexing_enabled=false` 的 space。此路徑有專屬整合測試（NFR-SEC-05，出貨阻斷條件）。
   - Rerank（可選 P1）：本地 `bge-reranker-v2-m3` 或 Voyage rerank API，對 top 20 重排取 top 6。
6. **回答生成**：system prompt 要求「僅根據提供資料回答，不足時明說；以繁體中文回答；每個論點標註 `[1][2]` 引用」。SSE 第一個事件即回 `sources: [{n, pageId, title, headingPath, blockId, snippet, url}]`，前端把 `[n]` 渲染成可點擊連結跳至該頁對應 block（id 錨點）。無檢索結果時直接回覆「知識庫中查無相關內容」而不呼叫 LLM 亂答。對話與引用快照寫入 `ai_conversations`/`ai_messages`（G3），配額計數寫 `ai_usage`。
7. **模型分工**：問答生成用 `claude-sonnet-5`；query rewrite／標題生成／對話命名等輕量任務用 `claude-haiku-4-5`。

**匯入管線（G2，`import-markdown` job）**：
1. UI 流程：上傳 zip → 結構預覽（目錄樹對應頁面樹）→ 確認 → job 進度 → 成功/失敗報告（逐檔列出轉換警告）。
2. Worker 處理：解壓 zip → 依目錄結構建立頁面樹（目錄=父頁、`.md` 檔=頁面，fractional index 依檔名排序）→ `from-markdown.ts` 將 md 轉 TipTap JSON（heading/block 補持久 id）→ 行內圖片與附件改寫：上傳至 StorageProvider、內容中的相對路徑改指向 `/api/files/:id` → 逐頁走正常存檔管線（衍生 content_md/content_text、版本快照 v1、enqueue embedding）。
3. **安全（強制）**：解壓總量上限（如 500MB）與檔案數上限（如 2,000）防 **zip bomb**、逐項壓縮率檢查；**路徑穿越檢查**（拒絕 `../`、絕對路徑、symlink）；單檔大小限制；僅處理白名單副檔名（`.md` 與圖片/附件白名單），其餘跳過並列入報告。

## B.8 LLM Provider 抽象層

```typescript
// src/lib/llm/provider.ts
export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export interface ChatParams {
  system?: string;
  messages: ChatMessage[];
  maxTokens: number;
  tier: 'primary' | 'light';        // 抽象「模型等級」而非寫死模型名
  signal?: AbortSignal;
}

export interface ChatDelta { type: 'text'; text: string }
export interface ChatResult { text: string; usage: { inputTokens: number; outputTokens: number }; model: string }

export interface LLMProvider {
  readonly name: string;
  chatStream(params: ChatParams): AsyncIterable<ChatDelta>;   // SSE 直通
  chat(params: ChatParams): Promise<ChatResult>;              // 非串流輕量任務
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], inputType: 'document' | 'query'): Promise<number[][]>;
}
```

**AnthropicProvider（前期）**——用官方 `@anthropic-ai/sdk`（MIT）：

```typescript
// src/lib/llm/anthropic.ts（節錄）
import Anthropic from '@anthropic-ai/sdk';

const MODEL_MAP = {
  primary: process.env.ANTHROPIC_MODEL_PRIMARY ?? 'claude-sonnet-5',
  light:   process.env.ANTHROPIC_MODEL_LIGHT   ?? 'claude-haiku-4-5',
};

async *chatStream(p: ChatParams) {
  const stream = this.client.messages.stream({
    model: MODEL_MAP[p.tier],
    max_tokens: p.maxTokens,
    system: p.system,
    messages: p.messages,
  }, { signal: p.signal });
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
      yield { type: 'text', text: event.delta.text };
  }
}
```

實作注意（依 2026 現況的 Anthropic API，已於審查時對照官方資料驗證）：
- **模型**：主力 `claude-sonnet-5`（1M context、$3/$15 per MTok，2026-08-31 前有 $2/$10 優惠價）；輕量 `claude-haiku-4-5`（200K context、$1/$5）。模型 ID 一律環境變數化。
- `claude-sonnet-5` **不接受非預設 `temperature`/`top_p`/`top_k`**（送了會 400），抽象層介面刻意**不暴露 sampling 參數**（ADR-009），跨 provider 也更乾淨；輸出風格靠 prompt 控制。對應的管理後台 AI 設定頁為**唯讀**健康檢查頁（C6，詳見 UI 規格）。
- Sonnet 5 省略 `thinking` 參數時預設 adaptive thinking；RAG 問答屬低推理需求，設 `output_config: { effort: 'low' }` 以壓低延遲與費用（此類 provider 專屬參數封裝在 Anthropic 實作內，不進抽象介面）。
- 一律使用 streaming（`messages.stream`）避免 HTTP timeout；`usage` 記入 metrics（NFR-OBS-04）與 `ai_usage` 配額計數。

**OpenAICompatProvider（後期 Local）**：以 `fetch` 呼叫 `POST {OPENAI_COMPAT_BASE_URL}/v1/chat/completions`（`stream: true`，解析 SSE `data:` 行），相容 Ollama / vLLM / LM Studio。model 由 `OPENAI_COMPAT_MODEL_PRIMARY/LIGHT` 指定（如 `qwen3-32b` 等中文能力強的開源模型）。

**切換方式**（NFR-COMP-01）：

```
LLM_PROVIDER=anthropic | openai-compat
EMBEDDING_PROVIDER=openai-compat | voyage
ANTHROPIC_API_KEY=...
OPENAI_COMPAT_BASE_URL=http://vllm.internal:8000
EMBEDDING_MODEL=bge-m3   EMBEDDING_DIMENSIONS=1024
```

由 `lib/llm/index.ts` 的 factory 依 env 產生單例；呼叫端只依賴介面。

**Embedding 選型與取捨（ADR-005：day-1 即採 local BGE-M3）**：

| 選項 | 優點 | 缺點 |
|---|---|---|
| Voyage AI（`voyage-3.5` 系列，多語） | 品質頂級、免自建推論、有 rerank API 配套 | 資料出外網（合規疑慮）、**換模型需全量重建向量**、按量計費 |
| **Local BGE-M3（已定案）**：Ollama/vLLM/TEI 跑 `bge-m3`（1024 維，MIT） | 中文表現優異、**day-1 即符合資料不外流**、之後不需 re-index 遷移、CPU 亦可跑（量小） | 需自架推論服務、極限品質略遜於商用頂級模型 |

理由：embedding 換模型的代價是全庫重算（chat 模型切換則零成本），先 local 可免一次大遷移；且文件全文送 embedding API 的外流面比問答更大，先堵住合規上最大的洞。透過 OpenAI-compatible embedding endpoint 呼叫，介面與後期完全一致。若推論硬體評估不可行（R3），備案為 Voyage 起步＋保留 `reindex-all` 與 G4 四步維度遷移路徑，並以 NFR-COMP-02 外呼盤點揭露。品質守門：30–50 題 golden question 檢索評測集（R3），任何 embedding/分詞/chunking 變更都跑一次。

## B.9 關鍵技術選型

| 項目 | 選擇 | 理由 | 授權 |
|---|---|---|---|
| ORM | **Drizzle ORM**（+ drizzle-kit migration） | 本專案重度使用 PG 專屬能力（recursive CTE、tsvector、pgvector、`SKIP LOCKED`），Drizzle 是「SQL 優先」薄封裝，raw SQL 與型別安全共存無摩擦；無 Prisma 的 engine 二進位與 schema DSL 隔閡，Docker image 更輕（C9：全專案統一 Drizzle） | Apache-2.0 |
| Editor | **TipTap 2**（開源核心 + 現成 extensions） | ProseMirror 生態、React 綁定佳、slash command/mention/table 用現成開源 extension 組出（R1：零自研 extension）；不使用 TipTap Cloud 付費件 | 核心 MIT |
| Auth | **自建 session（Lucia 模式）+ `openid-client` 預留 OIDC** | 需求＝credentials + DB session + 即時撤銷 + 未來 OIDC：Auth.js 對 credentials/DB session 組合支援彆扭且抽象厚；自建約數百行、完全掌控 audit 與撤銷；OIDC 用 `openid-client`（certified library）而非整包框架 | openid-client: MIT |
| Validation | **Zod** | Server Actions 輸入、env、API payload 單一驗證語彙；與 TS 型別推導整合最佳 | MIT |
| UI 基礎 | **Tailwind CSS + shadcn/ui（Radix primitives）** | 元件原始碼進 repo 可完全客製（符合「不得抄襲 GitBook 視覺」——自建設計系統）、Radix 提供無障礙互動基礎 | MIT |
| i18n | **next-intl** | App Router/RSC 支援最完整，訊息檔即 JSON | MIT |
| 佇列 | **pg-boss** | 用現有 PG 實現可靠 job（retry、cron 排程、archive），不引入 Redis | MIT |
| 測試 | **Vitest**（unit/integration，+ testcontainers 跑真 PG）＋ **Playwright**（E2E：登入、編輯、雙人編輯鎖、權限、AI 流） | Vitest 與 TS/ESM 零設定；權限測試必須跑真 PG 才有意義 | MIT / Apache-2.0 |
| Logging | **pino** | 高效 JSON structured log | MIT |
| 中文全文檢索 | **zhparser vs pgroonga —— M0 spike 定案（ADR-007，審查傾向 pgroonga）** | PG 內建 parser 不支援中文斷詞；zhparser 輕量、與 tsvector 直接相容，但 SCWS 詞庫以簡中為主；pgroonga n-gram 對繁中魯棒、免詞庫維護，代價是自建 DB image 較重。以 50–100 份真實文件＋20 條驗收查詢比較後定案 | zhparser: BSD 類；pgroonga: LGPL（內部部署無散布義務） |
| 密碼雜湊 | **@node-rs/argon2** | Rust 綁定、無需 node-gyp | MIT |
| 附件掃描 | ClamAV（P2，sidecar container） | 標準開源 AV | GPL（獨立行程呼叫，不連結進程式碼） |

## B.10 Docker Compose 與 K8s 遷移

**Compose 服務規劃**：

```yaml
services:
  proxy:      # Caddy（自動內部 TLS）或 Nginx → :443
  web:        # next start（standalone build），replicas 可 >1
    healthcheck: GET /api/readyz
  worker:     # 同 image，command: node worker.js
              # （embedding/匯出/匯入/掃描/cron 清理，見 B.1 職責表）
  db:         # postgres:16 + pgvector(>=0.8) + zhparser 或 pgroonga（自建 db image 裝 extension，依 M0 spike 定案）
    volumes: [pgdata]
  backup:     # cron 容器：pg_dump 每日 + WAL archive + restic 附件備份
  # minio:    # 可選——欲提前 stateless 化附件時啟用，StorageProvider 切 s3
  # clamav:   # P2
  # ollama/vllm:  # embedding 推論（day-1，BGE-M3）；Local LLM 階段擴為 chat 用（GPU 主機）
volumes: [pgdata, uploads, backups]
```

設定全部走 `.env`（範本 `.env.example` 進 repo，實值不進 repo）；image 以 CI 產出、tag 版本化。SMTP 設定（密碼重設信件依賴）列入 env 清單。

**K8s 遷移注意事項**（設計期即遵守，遷移時才無痛）：
1. **Stateless 已達成**：session 在 DB、附件經 StorageProvider——遷移時把 local volume 實作換成 S3/MinIO/Ceph 即可，web/worker 直接多副本。
2. **12-factor**：設定=env vars（→ ConfigMap/Secret）；log=stdout JSON（→ Fluent Bit/Loki）；`healthz/readyz` 直接對應 liveness/readiness probe。
3. **web 與 worker 分離的 entrypoint** → 兩個 Deployment，各自 HPA；pg-boss 佇列天然支援多 worker 競爭消費。
4. **Migration 執行策略**：schema migration 作為獨立步驟（Job/initContainer）跑 `drizzle-kit migrate`，不在 app 啟動時隱式執行，避免多副本競態。
5. **DB 不進 K8s（初期）**：PostgreSQL 續留 VM 或改用受管服務；K8s 只跑無狀態層。
6. **檔案上傳大小**：proxy 與未來 ingress 的 body size limit 要一致設定（50MB）。
7. **graceful shutdown**：處理 SIGTERM——web 停收新請求、worker 完成手上 job 再退出（K8s rolling update 的前提）。
8. 提前避免的地雷：不用本機記憶體做跨請求狀態（rate limit 計數器設計成可插拔 store）、不依賴本機磁碟暫存路徑（用 os.tmpdir 且用完即刪）、不假設單一 instance（排程任務由 pg-boss 的分散式鎖派發）。

---

## 落地順序建議（Phase）

1. **Phase 1（基礎）**：DB schema **一次補齊**（含鎖欄位、四級角色、visibility 三態、groups、slug history、AI 三表、page_visits、space_pinned_pages、collections 預留——避免 Phase 1 後改表）+ auth/session + spaces/pages 樹 + TipTap 編輯（含編輯鎖）與版本快照 + 權限模型 + 全文搜尋（分詞依 M0 spike 定案）。
2. **Phase 2（AI）**：LLM/Embedding 抽象層（embedding 即 local BGE-M3）+ chunking/索引 worker + hybrid 檢索（含權限過濾測試=出貨閘門）+ RAG 問答 SSE + Markdown 匯入 + 寫作輔助。
3. **Phase 3（完善）**：留言/通知、群組管理 UI、匯出、audit 檢視、metrics、附件掃描、rerank、Local LLM 切換演練。

---

## Critical Files for Implementation

- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/lib/db/schema.ts —— 全部資料模型（樹、版本、鎖、權限、群組、向量、AI 對話/配額、審計）的單一定義點
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/lib/authz/permission.ts —— 三層權限判斷唯一入口（四級角色、visibility 三態、群組主體），UI/API/RAG 共用
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/lib/llm/provider.ts —— LLM/Embedding Provider 介面與 factory（Anthropic ↔ OpenAI-compatible 切換核心）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/lib/rag/retriever.ts —— hybrid 檢索 + 權限過濾 SQL + iterative scan/over-fetch 調校（本系統最關鍵的安全路徑）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/src/actions/page.ts —— savePage 的編輯鎖＋樂觀版本檢查＋衍生內容同步＋slug 歷史寫入（C1/C2/G1 匯聚點）
- /Users/sheldon.chang/Documents/ClaudePlayground/JetBook/docker-compose.yml —— web/worker/db/backup 服務拓撲與 12-factor 設定注入
