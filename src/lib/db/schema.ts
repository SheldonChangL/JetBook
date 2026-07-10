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
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
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

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
