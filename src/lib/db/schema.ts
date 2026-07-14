/**
 * JetBook 資料模型單一定義點（Drizzle schema）。
 *
 * 「schema 一次補齊」原則（審查 C3/C4/C5/G1/G8/G9/G10）：認證與群組相關表在
 * B-01 全數建立；spaces/pages 相關表由 C-01/C-02 接續；版本/附件/向量表再往後。
 * 所有變更走 drizzle-kit 版本化 migration（npm run db:generate → db:migrate）。
 */
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { AiSource } from "@/lib/ai/types";

/** 系統層級角色：admin 可管理使用者與全部空間；member 為一般成員。 */
export const orgRoleEnum = pgEnum("org_role", ["admin", "member"]);
/** 身分來源：local＝本地帳密；oidc＝SSO（B-06 預留，共用同一張表與 session）。 */
export const authProviderEnum = pgEnum("auth_provider", ["local", "oidc"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    /** OIDC 使用者可為空 */
    passwordHash: text("password_hash"),
    orgRole: orgRoleEnum("org_role").notNull().default("member"),
    authProvider: authProviderEnum("auth_provider").notNull().default("local"),
    oidcSubject: text("oidc_subject").unique(),
    isActive: boolean("is_active").notNull().default(true),
    /** 外觀偏好（B-08）：light/dark/system；null＝未設定（視同跟隨系統），跨裝置同步。 */
    themePreference: text("theme_preference"),
    /**
     * Email 通知偏好（M4-05，F-NOTIF-02）：{ [通知類型]: boolean }。
     * null 或缺鍵＝該類型啟用（預設全開，使用者可逐類停用）。
     */
    emailNotificationPrefs: jsonb("email_notification_prefs").$type<Record<
      string,
      boolean
    > | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 只存 sha256(token)，原始 token 僅存在於使用者 cookie */
    tokenHash: text("token_hash").notNull().unique(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** 絕對逾時：建立起 30 天 */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** 閒置逾時依據：最後活動起 7 天 */
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_sessions_user").on(table.userId)],
);

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] })],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_prt_user").on(table.userId)],
);

/** 帳號層級登入失敗節流（B-02，防撞庫；DB 存放供多副本共用）。 */
export const loginThrottle = pgTable("login_throttle", {
  email: text("email").primaryKey(),
  failedCount: integer("failed_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastFailedAt: timestamp("last_failed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Space 與組織（C-01；schema 一次補齊 C4/G8/G10） ──────────────────────

/** Space 可見性三態（C4）：private 僅成員；org_read 全員可讀；org_write 全員可編輯。 */
export const spaceVisibilityEnum = pgEnum("space_visibility", [
  "private",
  "org_read",
  "org_write",
]);
/** Space 成員角色四級（C3）：admin 管理；editor 編輯；commenter 讀+留言；viewer 唯讀。 */
export const spaceRoleEnum = pgEnum("space_role", ["admin", "editor", "commenter", "viewer"]);

/**
 * 頁面樹節點型別（C-11，F-PAGE-04）：
 * - `page`＝一般內容頁（有內文、可編輯、進搜尋/RAG，預設值）；
 * - `group`＝群組分節標題（僅結構、無內文，不可開啟為頁面）；
 * - `external_link`＝外部連結節點（點擊以新分頁開啟 `external_url`，無內文、無子節點）。
 * 僅 `page` 進全文檢索與 RAG（getAccessiblePageIds 於 SQL 層以 kind='page' 收斂）。
 */
export const pageKindEnum = pgEnum("page_kind", ["page", "group", "external_link"]);

/** 單列組織設定（F-ORG-01）。 */
export const orgSettings = pgTable("org_settings", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull().default("Jet Opto 凱銳光電"),
  logoUrl: text("logo_url"),
  defaultLocale: text("default_locale").notNull().default("zh-TW"),
  aiEnabled: boolean("ai_enabled").notNull().default(true),
  /** AI 每人每日查詢配額（I-09，F-AI-11）；null＝不限。強制點於 /api/ai/chat。 */
  aiDailyQuotaPerUser: integer("ai_daily_quota_per_user"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Collection：Space 分組預留（G10/F-ORG-03，M3 啟用）。 */
export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    visibility: spaceVisibilityEnum("visibility").notNull().default("private"),
    /** 敏感空間可關閉 AI 索引（NFR-COMP-03） */
    aiIndexingEnabled: boolean("ai_indexing_enabled").notNull().default(true),
    collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("ix_spaces_collection").on(table.collectionId)],
);

export const spaceMembers = pgTable(
  "space_members",
  {
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: spaceRoleEnum("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.userId] })],
);

/**
 * Space 掛載群組授權（K-03，主體泛化 C5）：一個群組以某角色掛在某 space，
 * 群組全體成員即以該角色繼承 space 存取權。使用者的有效角色＝直接成員與所有
 * 群組來源角色取最高（見 lib/authz）。移出群組即失效（F-SEC-06）由此表 join 保證。
 */
export const spaceMemberGroups = pgTable(
  "space_member_groups",
  {
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    role: spaceRoleEnum("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.groupId] }),
    index("ix_smg_group").on(table.groupId),
  ],
);

/** Space 首頁釘選頁面（G8/F-ORG-06，最多 6）。page_id 於 C-02 加 FK。 */
export const spacePinnedPages = pgTable(
  "space_pinned_pages",
  {
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.pageId] })],
);

// ── 頁面（C-02；schema 一次補齊 C1 鎖欄位/G1 slug 歷史/G9 瀏覽紀錄） ──────────

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    /** 鄰接表：父頁；根層為 null（ADR-001） */
    parentId: uuid("parent_id"),
    /**
     * 節點型別（C-11，F-PAGE-04）：page＝一般內容頁；group＝群組分節標題（無內文、不可開啟）；
     * external_link＝外部連結（新分頁開 external_url）。預設 page。
     */
    kind: pageKindEnum("kind").notNull().default("page"),
    /** external_link 節點的目標 URL（僅 kind='external_link' 有值；http/https）。 */
    externalUrl: text("external_url"),
    /** fractional index 排序鍵（同層相對順序；插入取中值免重排） */
    position: text("position").notNull().default("a0"),
    slug: text("slug").notNull(),
    title: text("title").notNull().default(""),
    icon: text("icon"),
    /** TipTap/ProseMirror JSON canonical（ADR-002） */
    content: jsonb("content"),
    /** 衍生：匯出與 RAG chunking 用 */
    contentMd: text("content_md").notNull().default(""),
    /** 衍生：純文字，餵 pgroonga 全文索引（ADR-007，不用 tsvector） */
    contentText: text("content_text").notNull().default(""),
    currentVersionNo: integer("current_version_no").notNull().default(0),
    /** 頁面層限制存取旗標（page_permissions 覆寫用，後續 issue 啟用） */
    restricted: boolean("restricted").notNull().default(false),
    // ── C1 軟性編輯鎖 ──
    lockedBy: uuid("locked_by").references(() => users.id, { onDelete: "set null" }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("ix_pages_space").on(table.spaceId),
    index("ix_pages_parent").on(table.parentId),
    // 同 space 內 slug 唯一（未刪除者）
    uniqueIndex("ux_pages_space_slug").on(table.spaceId, table.slug),
  ],
);

/** 版本快照（E-01；完整 JSON 快照非 delta，ADR-008）。 */
export const pageVersions = pgTable(
  "page_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    title: text("title").notNull(),
    content: jsonb("content"),
    contentMd: text("content_md").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** 命名版本（如「還原自 v3」）；一般自動快照為 null */
    note: text("note"),
  },
  (table) => [
    uniqueIndex("ux_page_versions_page_no").on(table.pageId, table.versionNo),
    index("ix_page_versions_page").on(table.pageId),
  ],
);

/** slug 歷史：改名後舊 URL 301 導向（G1/F-PAGE-03）。 */
export const pageSlugHistory = pgTable(
  "page_slug_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    oldSlug: text("old_slug").notNull(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ux_slug_history_space_slug").on(table.spaceId, table.oldSlug)],
);

/** 最近瀏覽（G9/F-PUB-03 Dashboard「繼續閱讀」來源）。 */
export const pageVisits = pgTable(
  "page_visits",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.pageId] })],
);

// ── 附件（M-01；儲存本體在 StorageProvider，DB 只存 metadata） ──────────────

/**
 * 附件 metadata（F-FILE-*）。實體檔案由 `src/lib/storage/` 的 StorageProvider
 * 管理（本地實作存 UPLOAD_DIR 下 UUID 檔名，防原始檔名注入/路徑跳脫）。
 * page_id 可為 null：上傳當下尚未掛到頁面（編輯器插入前）或頁面刪除後保留檔案。
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" }),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    uploaderId: uuid("uploader_id").references(() => users.id, { onDelete: "set null" }),
    /** 原始檔名（僅供顯示/下載命名；絕不作為儲存路徑） */
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** StorageProvider 內的鍵（本地實作＝UUID+副檔名） */
    storageKey: text("storage_key").notNull().unique(),
    /** 內容 sha256 hex（完整性驗證／未來去重依據） */
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_attachments_page").on(table.pageId),
    index("ix_attachments_space").on(table.spaceId),
  ],
);

/**
 * Office 附件的衍生 PDF 預覽（M4-12，issue #216）。與 attachments 1:1
 * （attachment_id 為 PK＋cascade），實體衍生檔同存 StorageProvider；
 * 附件 GC 回收時需一併刪除衍生檔（列隨 FK cascade）。
 */
export const attachmentPreviews = pgTable("attachment_previews", {
  attachmentId: uuid("attachment_id")
    .primaryKey()
    .references(() => attachments.id, { onDelete: "cascade" }),
  /** pending＝轉檔中；ready＝可預覽；failed＝轉檔失敗（error 記原因） */
  status: text("status", { enum: ["pending", "ready", "failed"] })
    .notNull()
    .default("pending"),
  /** 衍生 PDF 的 StorageProvider 鍵；ready 時必有值 */
  storageKey: text("storage_key"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 頁面留言（K-01；F-COLLAB-02 頁面級討論串，設計規範 §3.9） ────────────────

/**
 * 頁面留言（K-01，F-COLLAB-02）：頁面級討論串。
 * - `parent_comment_id` 自關聯：null＝頂層討論串、非 null＝回覆（一層縮排即可，v1 不做多層巢狀）。
 *   父留言硬刪時 cascade 連帶刪除回覆；一般刪除走 `deleted_at` 軟刪（保留討論串脈絡）。
 * - `author_id` set null：作者帳號刪除後留言保留、僅作者顯示轉為未知。
 * - `resolved_at` 僅對頂層留言有意義：標記解決後整串在 UI 收合至「已解決」。
 * - 權限：留言需 commenter+（authz `page.comment`）；刪除限本人或 space admin（薄殼於 action 判斷）。
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    /** 回覆指向的父留言；頂層討論串為 null（自關聯，父硬刪時 cascade） */
    parentCommentId: uuid("parent_comment_id").references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    /** 作者；帳號刪除後留言保留、作者顯示為未知（set null） */
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** 標記解決時間（僅頂層留言）；null＝未解決 */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** 軟刪除：保留討論串脈絡（有回覆的頂層留言刪除後以墓碑顯示） */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("ix_comments_page").on(table.pageId),
    index("ix_comments_parent").on(table.parentCommentId),
  ],
);

// ── 站內通知（K-02；F-NOTIF-01，設計規範 §3.9 通知中心） ─────────────────────

/**
 * API Token（M4-06，F-API-02）：個人 token 供 REST API Bearer 認證。
 * 明文只在建立當下回傳一次；DB 僅存 sha256 hash（同 session token 策略）。
 * 權限完全繼承 token 擁有者（lib/authz），scopes 僅限縮 API 面（v1：read）。
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** sha256(token) hex；明文不落 DB */
    tokenHash: text("token_hash").notNull().unique(),
    /** 授權範圍；v1 僅 "read"（欄位預留未來 write） */
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["read"]),
    /** 到期時間；null＝永不過期 */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    /** 撤銷時間；非 null 即立即失效 */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_api_tokens_user").on(table.userId)],
);

/**
 * 站內通知（K-02，F-NOTIF-01）：使用者層級的事件收件匣。
 * - `type`＝事件種類（如 comment_reply）；`payload` jsonb 帶顯示與跳轉所需欄位
 *   （至少含 `url` 供點擊直達，其餘依 type 而定，如 actorName/pageTitle/excerpt）。
 * - `read_at` null＝未讀；標為已讀寫入時間戳（不刪除，保留歷史）。
 * - user_id cascade：使用者刪除時其通知一併清除。
 * - `(user_id, read_at)` 複合索引：鈴鐺未讀計數與收件匣查詢皆以 user_id 起手、read_at 篩未讀。
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 事件種類（`<domain>_<verb>`），如 comment_reply */
    type: text("type").notNull(),
    /** 顯示與跳轉脈絡（jsonb，至少含 url）；禁止放密碼、token、文件全文 */
    payload: jsonb("payload"),
    /** 已讀時間；null＝未讀 */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_notifications_user_read").on(table.userId, table.readAt)],
);

// ── 頁面嵌入向量（H-06；語意檢索索引，ADR-005 BGE-M3 1024 維） ────────────────

/**
 * 頁面嵌入向量（H-06，架構 B.7）：每頁 chunk 一列，供語意／hybrid 檢索。
 * - `embedding` 為 pgvector vector(1024)（day-1 local BGE-M3，維度固定；換模型走 reindex migration，ADR-005）。
 * - `(page_id, chunk_index)` 唯一：增量重嵌以 upsert 更新既有 chunk。
 * - `content_hash`＝chunk 原始內容 sha256：內容未變的 chunk 略過重算 embedding。
 * - page_id FK cascade：頁面硬刪時向量一併消失；軟刪／關閉 AI 索引時由 embed job 清除。
 * - HNSW 索引（vector_cosine_ops）無法由 drizzle schema 表達，於自訂 migration 建立。
 */
export const pageEmbeddings = pgTable(
  "page_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    /** chunker 產生的 chunk 序號（0 起，同頁連續） */
    chunkIndex: integer("chunk_index").notNull(),
    /** chunk 原始內容 sha256 hex（增量重嵌比對鍵） */
    contentHash: text("content_hash").notNull(),
    /** heading 階層路徑（檢索結果定位／來源標註用） */
    headingPath: text("heading_path").notNull().default(""),
    /** 送嵌入的完整 chunk 文字（含 context header；檢索片段回填用） */
    chunkText: text("chunk_text").notNull(),
    /** chunk token 估算（觀測／容量用） */
    tokenCount: integer("token_count").notNull().default(0),
    /** 嵌入向量（1024 維，vector_cosine_ops HNSW 於自訂 migration 建索引） */
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_page_embeddings_page_chunk").on(table.pageId, table.chunkIndex),
    index("ix_page_embeddings_page").on(table.pageId),
  ],
);

// ── 稽核日誌（B-07；Must/P0，審查 C8） ──────────────────────────────────────

/**
 * 稽核日誌（append-only）：只經 `src/lib/audit.ts` 的 writeAudit 寫入，
 * 無任何更新/刪除路徑，也不對一般使用者暴露讀取 API（僅後續 L-02 管理後台可讀）。
 * actor_id 不掛 FK：使用者刪除後稽核紀錄必須原樣保留（NFR-SEC-06 保留 1 年）。
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** 行為者；匿名事件（如登入失敗且帳號不存在）為 null */
    actorId: uuid("actor_id"),
    /** 事件動作，如 auth.login / space.create / page.delete */
    action: text("action").notNull(),
    /** 目標資源類型，如 user / space / page */
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_audit_logs_actor").on(table.actorId),
    index("ix_audit_logs_created").on(table.createdAt),
  ],
);

// ── AI 對話與歷史（I-07；F-AI-07 多輪對話、稽核與回饋分析 G3） ─────────────────

/**
 * AI 問答對話（I-07，F-AI-07）：一段多輪對話的容器。
 * - user_id cascade：對話為使用者私有資源，帳號刪除時一併清除；讀取一律 `where user_id = 自己`
 *   （對話與訊息僅本人可讀，權限以擁有者過濾，非 space/page RBAC）。
 * - title：由首問經 light tier 生成的短標題（生成前先以截斷首問作為暫定值）。
 * - space_id（可空、無 FK）：對話若限定單一 space 檢索則記錄之，供續談沿用同一檢索範圍；
 *   為使用者側 scope 快照，不掛 FK（space 刪除後僅使檢索落空，不影響對話本體）。
 */
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    /** 限定檢索的 space（可空）；為擁有者側 scope 快照，不掛 FK */
    spaceId: uuid("space_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_ai_conversations_user").on(table.userId)],
);

/**
 * AI 對話訊息（I-07，F-AI-07）：對話內每一則使用者提問或 AI 回答。
 * - conversation_id cascade：對話刪除時訊息一併清除；查詢一律經對話擁有者驗證後才回傳。
 * - role：`user`（提問）或 `assistant`（回答）。
 * - sources（jsonb 可空）：assistant 訊息附「檢索到的 chunk 引用快照」（AnswerSource[]），
 *   供稽核與回饋分析（G3）與歷史重載時還原來源卡片；user 訊息為 null。
 * - created_at 排序 + `(conversation_id, created_at)` 索引：載入歷史依時間序（成對 user/assistant）。
 */
export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull().default(""),
    /** 檢索 chunk 引用快照（assistant 訊息用；AnswerSource 形狀，見 src/lib/ai/types.ts） */
    sources: jsonb("sources").$type<AiSource[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_ai_messages_conversation").on(table.conversationId, table.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type SpaceMember = typeof spaceMembers.$inferSelect;
export type SpaceMemberGroup = typeof spaceMemberGroups.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;
export type SpaceRole = (typeof spaceRoleEnum.enumValues)[number];
export type SpaceVisibility = (typeof spaceVisibilityEnum.enumValues)[number];
export type Page = typeof pages.$inferSelect;
export type PageKind = (typeof pageKindEnum.enumValues)[number];
export type PageVersion = typeof pageVersions.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type PageEmbedding = typeof pageEmbeddings.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type AiConversation = typeof aiConversations.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
