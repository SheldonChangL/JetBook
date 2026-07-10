import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { loginThrottle } from "@/lib/db/schema";

/**
 * 帳號層級登入失敗節流（防撞庫，NFR-SEC 相關）。
 * 存 DB（多副本共用）：連續失敗 ≥5 次後鎖定，鎖定時間隨失敗次數遞增，上限 15 分鐘。
 */
const FREE_ATTEMPTS = 5;
const MAX_LOCK_MS = 15 * 60 * 1000;

function lockDurationMs(failedCount: number): number {
  if (failedCount < FREE_ATTEMPTS) return 0;
  // 第 5 次起：30s、60s、120s…上限 15 分鐘
  return Math.min(30_000 * 2 ** (failedCount - FREE_ATTEMPTS), MAX_LOCK_MS);
}

/** 回傳剩餘鎖定秒數；0＝未鎖定。 */
export async function getLockRemainingSeconds(email: string): Promise<number> {
  const row = await db.query.loginThrottle.findFirst({
    where: eq(loginThrottle.email, email),
  });
  if (!row?.lockedUntil) return 0;
  const remaining = row.lockedUntil.getTime() - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export async function recordLoginFailure(email: string): Promise<void> {
  const now = new Date();
  await db
    .insert(loginThrottle)
    .values({ email, failedCount: 1, lastFailedAt: now, lockedUntil: null })
    .onConflictDoUpdate({
      target: loginThrottle.email,
      set: {
        failedCount: sql`${loginThrottle.failedCount} + 1`,
        lastFailedAt: now,
      },
    });

  const row = await db.query.loginThrottle.findFirst({
    where: eq(loginThrottle.email, email),
  });
  if (!row) return;
  const lockMs = lockDurationMs(row.failedCount);
  if (lockMs > 0) {
    await db
      .update(loginThrottle)
      .set({ lockedUntil: new Date(now.getTime() + lockMs) })
      .where(eq(loginThrottle.email, email));
  }
}

export async function resetLoginFailures(email: string): Promise<void> {
  await db.delete(loginThrottle).where(eq(loginThrottle.email, email));
}
