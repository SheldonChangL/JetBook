import "server-only";
import { createHash, randomBytes } from "crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sessions, users, type Session, type User } from "@/lib/db/schema";
import { env } from "@/lib/env";

/**
 * DB-backed opaque session（ADR-004）：
 * - 256-bit 隨機 token，DB 只存 sha256(token)（token 外洩面最小化）
 * - 即時撤銷：停權/登出/換密碼 → 刪列即失效（JWT 做不到）
 * - Cookie：HttpOnly; Secure(生產); SameSite=Lax
 * - 閒置逾時 7 天、絕對逾時 30 天（NFR-SEC-03）
 */
export const SESSION_COOKIE = "jetbook_session";

const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** last_active_at 更新節流：距上次超過 1 小時才寫 DB */
const ACTIVITY_REFRESH_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionValidationResult {
  user: User;
  session: Session;
}

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; session: Session }> {
  const token = randomBytes(32).toString("base64url");
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt: new Date(Date.now() + ABSOLUTE_TTL_MS),
    })
    .returning();
  if (!session) {
    throw new Error("session 建立失敗");
  }
  return { token, session };
}

/** 驗證 token：不存在／絕對逾時／閒置逾時／帳號停用 → null（逾時列順手清除）。 */
export async function validateSessionToken(token: string): Promise<SessionValidationResult | null> {
  const now = new Date();
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const idleDeadline = row.session.lastActiveAt.getTime() + IDLE_TTL_MS;
  if (now.getTime() > idleDeadline || !row.user.isActive) {
    await db.delete(sessions).where(eq(sessions.id, row.session.id));
    return null;
  }

  if (now.getTime() - row.session.lastActiveAt.getTime() > ACTIVITY_REFRESH_MS) {
    await db
      .update(sessions)
      .set({ lastActiveAt: now })
      .where(eq(sessions.id, row.session.id));
    row.session.lastActiveAt = now;
  }

  return { user: row.user, session: row.session };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** 撤銷使用者全部 session（停權、換密碼時呼叫）。 */
export async function invalidateUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** 清除絕對逾時的 session 列（cron job 用，G11）。 */
export async function deleteExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}
