import "server-only";
import { randomBytes } from "crypto";
import { and, eq, max, ne } from "drizzle-orm";
import { db, type Db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";
import { hashPassword, isPasswordAcceptable } from "@/lib/auth/password";
import { invalidateUserSessions } from "@/lib/auth/session";

/**
 * 使用者管理商業邏輯（F-ADMIN-01，L-01）。
 * 權限斷言在 action 薄殼層（assertOrgAdmin）；此層只負責資料規則：
 * - email 唯一（EMAIL_TAKEN）
 * - 最後一位啟用中 org admin 保護（LAST_ORG_ADMIN）——降級與停用皆適用，防鎖死後台
 * - 停用／重設密碼即撤銷全部 session（F-ADMIN-01 驗收 1、F-SEC-02）
 */

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  orgRole: User["orgRole"];
  authProvider: User["authProvider"];
  isActive: boolean;
  createdAt: Date;
  /** 最後登入＝該使用者全部 session 的 max(last_active_at)；從未登入為 null */
  lastLoginAt: Date | null;
}

export async function listUsers(): Promise<AdminUserRow[]> {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      orgRole: users.orgRole,
      authProvider: users.authProvider,
      isActive: users.isActive,
      createdAt: users.createdAt,
      lastLoginAt: max(sessions.lastActiveAt),
    })
    .from(users)
    .leftJoin(sessions, eq(sessions.userId, users.id))
    .groupBy(users.id)
    .orderBy(users.createdAt);
}

/** PG unique violation（23505）；drizzle 會包一層 DrizzleQueryError，原始錯誤在 cause 鏈。 */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  while (typeof current === "object" && current !== null) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface CreateUserInput {
  name: string;
  email: string;
  /** 初始密碼（管理者建立時設定，交付給使用者後應自行變更） */
  password: string;
  orgRole: User["orgRole"];
}

export async function createUser(input: CreateUserInput): Promise<User> {
  if (!isPasswordAcceptable(input.password)) throw new Error("WEAK_PASSWORD");
  const passwordHash = await hashPassword(input.password);
  try {
    const [created] = await db
      .insert(users)
      .values({
        name: input.name,
        email: input.email,
        passwordHash,
        orgRole: input.orgRole,
        authProvider: "local",
      })
      .returning();
    if (!created) throw new Error("使用者建立失敗");
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("EMAIL_TAKEN");
    throw err;
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** 除指定使用者外，仍啟用中的 org admin 數。 */
async function countOtherActiveAdmins(tx: Tx, userId: string): Promise<number> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgRole, "admin"), eq(users.isActive, true), ne(users.id, userId)));
  return rows.length;
}

/** 停用/啟用。停用最後一位啟用中 admin → LAST_ORG_ADMIN；停用後立即撤銷全部 session。 */
export async function setUserActive(userId: string, isActive: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const target = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (!target) throw new Error("NOT_FOUND");
    if (!isActive && target.orgRole === "admin" && target.isActive) {
      if ((await countOtherActiveAdmins(tx, userId)) === 0) throw new Error("LAST_ORG_ADMIN");
    }
    await tx.update(users).set({ isActive, updatedAt: new Date() }).where(eq(users.id, userId));
  });
  if (!isActive) await invalidateUserSessions(userId);
}

/** 切換系統角色。將最後一位啟用中 admin 降為 member → LAST_ORG_ADMIN。 */
export async function setUserOrgRole(userId: string, orgRole: User["orgRole"]): Promise<void> {
  await db.transaction(async (tx) => {
    const target = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (!target) throw new Error("NOT_FOUND");
    if (target.orgRole === "admin" && orgRole !== "admin" && target.isActive) {
      if ((await countOtherActiveAdmins(tx, userId)) === 0) throw new Error("LAST_ORG_ADMIN");
    }
    await tx.update(users).set({ orgRole, updatedAt: new Date() }).where(eq(users.id, userId));
  });
}

/** 產生隨機初始密碼（base64url，16 字元，滿足密碼原則）。 */
export function generateRandomPassword(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * 強制重設密碼：產生隨機密碼、覆寫 hash、撤銷全部 session（F-SEC-02）。
 * 回傳明文密碼——僅此一次，呼叫端顯示後不再保存。
 */
export async function resetUserPassword(userId: string): Promise<string> {
  const password = generateRandomPassword();
  const passwordHash = await hashPassword(password);
  const [updated] = await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw new Error("NOT_FOUND");
  await invalidateUserSessions(userId);
  return password;
}
