import "server-only";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, users } from "@/lib/db/schema";

/**
 * 軟性編輯鎖（C1 / ADR-006）：心跳續租 30s、閒置 5 分鐘視為過期可被搶。
 * 樂觀版本檢查（savePage 的 currentVersionNo）為第二道防線。
 */
export const LOCK_IDLE_MS = 5 * 60 * 1000;

export interface LockState {
  lockedByMe: boolean;
  lockedByOther: boolean;
  lockedBy: string | null;
  /** 鎖持有者顯示姓名（他人持鎖時供 UI 提示；無鎖為 null）。 */
  lockedByName: string | null;
}

function staleBefore(): Date {
  return new Date(Date.now() - LOCK_IDLE_MS);
}

/**
 * 嘗試取得/續租鎖。原子 UPDATE：無鎖、已是自己、或既有鎖已過期時才寫入。
 * 回傳是否持有鎖。Admin 搶鎖走 force=true（略過過期判斷）。
 */
export async function acquireLock(
  pageId: string,
  userId: string,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const now = new Date();
  const takeable = options.force
    ? sql`true`
    : or(
        isNull(pages.lockedBy),
        eq(pages.lockedBy, userId),
        lt(pages.lockedAt, staleBefore()),
      );
  const result = await db
    .update(pages)
    .set({ lockedBy: userId, lockedAt: now })
    .where(and(eq(pages.id, pageId), isNull(pages.deletedAt), takeable))
    .returning({ id: pages.id });
  return result.length > 0;
}

/** 心跳續租（僅當自己仍持鎖時）。 */
export async function heartbeatLock(pageId: string, userId: string): Promise<boolean> {
  const result = await db
    .update(pages)
    .set({ lockedAt: new Date() })
    .where(and(eq(pages.id, pageId), eq(pages.lockedBy, userId)))
    .returning({ id: pages.id });
  return result.length > 0;
}

/** 釋放鎖（僅當自己持鎖）。 */
export async function releaseLock(pageId: string, userId: string): Promise<void> {
  await db
    .update(pages)
    .set({ lockedBy: null, lockedAt: null })
    .where(and(eq(pages.id, pageId), eq(pages.lockedBy, userId)));
}

/** 查詢當前鎖狀態（未過期才算有效鎖），含持有者姓名（join users）。 */
export async function getLockState(pageId: string, userId: string): Promise<LockState> {
  const [row] = await db
    .select({
      lockedBy: pages.lockedBy,
      lockedAt: pages.lockedAt,
      lockedByName: users.name,
    })
    .from(pages)
    .leftJoin(users, eq(users.id, pages.lockedBy))
    .where(eq(pages.id, pageId))
    .limit(1);
  if (!row?.lockedBy || !row.lockedAt || row.lockedAt < staleBefore()) {
    return { lockedByMe: false, lockedByOther: false, lockedBy: null, lockedByName: null };
  }
  return {
    lockedByMe: row.lockedBy === userId,
    lockedByOther: row.lockedBy !== userId,
    lockedBy: row.lockedBy,
    lockedByName: row.lockedByName,
  };
}
