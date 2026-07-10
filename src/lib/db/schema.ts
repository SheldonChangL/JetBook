/**
 * JetBook 資料模型單一定義點（Drizzle schema）。
 *
 * 「schema 一次補齊」原則（審查 C3/C4/C5/G1/G8/G9/G10）：認證與群組相關表在
 * B-01 全數建立；spaces/pages 相關表由 C-01/C-02 接續；版本/附件/向量表再往後。
 * 所有變更走 drizzle-kit 版本化 migration（npm run db:generate → db:migrate）。
 */
import {
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
} from "drizzle-orm/pg-core";

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

/** 單列組織設定（F-ORG-01）。 */
export const orgSettings = pgTable("org_settings", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull().default("Jet Opto 捷揚光電"),
  logoUrl: text("logo_url"),
  defaultLocale: text("default_locale").notNull().default("zh-TW"),
  aiEnabled: boolean("ai_enabled").notNull().default(true),
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

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type SpaceMember = typeof spaceMembers.$inferSelect;
export type SpaceRole = (typeof spaceRoleEnum.enumValues)[number];
export type SpaceVisibility = (typeof spaceVisibilityEnum.enumValues)[number];
export type Page = typeof pages.$inferSelect;
export type PageVersion = typeof pageVersions.$inferSelect;
