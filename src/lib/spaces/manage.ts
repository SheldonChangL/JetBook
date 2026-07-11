import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaceMembers, spaces, users, type SpaceRole } from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/** 軟刪除 Space 保留天數；逾期由 worker cron（purge-trash）永久清除。 */
export const SPACE_TRASH_RETENTION_DAYS = 30;

/**
 * Space 管理商業邏輯（C-07）。權限斷言在 action 薄殼層（assertCan space.manage）；
 * 此層只負責資料規則：成員列表、候選使用者、角色變更（含最後一位 admin 保護）、封存切換。
 * 抽出至 lib 以符合薄殼原則並可用真 PG 直接驗證。
 */

export interface SpaceMemberRow {
  userId: string;
  name: string;
  email: string;
  role: SpaceRole;
  createdAt: Date;
}

/** 列出某 Space 的直接成員（頭像＋姓名＋email＋角色＋加入時間；來源 badge 於 K-03 群組併入）。 */
export async function listSpaceMembers(spaceId: string): Promise<SpaceMemberRow[]> {
  return db
    .select({
      userId: spaceMembers.userId,
      name: users.name,
      email: users.email,
      role: spaceMembers.role,
      createdAt: spaceMembers.createdAt,
    })
    .from(spaceMembers)
    .innerJoin(users, eq(users.id, spaceMembers.userId))
    .where(eq(spaceMembers.spaceId, spaceId))
    .orderBy(asc(spaceMembers.createdAt));
}

export interface CandidateUser {
  id: string;
  name: string;
  email: string;
}

/** 全體啟用中使用者（加入成員 combobox 搜尋來源）。 */
export async function listActiveUsers(): Promise<CandidateUser[]> {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.name));
}

/**
 * 設定/移除成員角色。role=null 移除成員。
 * 保護：不可移除或降級最後一位 admin（LAST_ADMIN）——防止空間失去管理者。
 */
export async function setSpaceMemberRole(
  spaceId: string,
  userId: string,
  role: SpaceRole | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const admins = await tx
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.role, "admin")));
    const isLastAdmin = admins.length === 1 && admins[0]?.userId === userId && role !== "admin";
    if (isLastAdmin) throw new Error("LAST_ADMIN");

    if (role === null) {
      await tx
        .delete(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)));
      return;
    }
    await tx
      .insert(spaceMembers)
      .values({ spaceId, userId, role })
      .onConflictDoUpdate({
        target: [spaceMembers.spaceId, spaceMembers.userId],
        set: { role },
      });
  });
}

/** 封存/取消封存 Space（archived_at）。封存後由 accessibleSpaceCondition 自列表/搜尋排除。 */
export async function setSpaceArchived(spaceId: string, archived: boolean): Promise<void> {
  await db
    .update(spaces)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(spaces.id, spaceId));
}

/**
 * 軟刪除 Space（deleted_at）。刪除後由 accessibleSpaceCondition／getAccessiblePageIds
 * 自列表、搜尋、RAG 全面排除（含其所有頁面），內容保留待還原或逾期清除。
 * 已軟刪的 space 再次刪除為 no-op（回傳既有時間）。回傳實際的 deleted_at。
 */
export async function softDeleteSpace(spaceId: string): Promise<Date> {
  const now = new Date();
  const [row] = await db
    .update(spaces)
    .set({ deletedAt: now })
    .where(and(eq(spaces.id, spaceId), isNull(spaces.deletedAt)))
    .returning({ deletedAt: spaces.deletedAt });
  if (row?.deletedAt) return row.deletedAt;
  // 已軟刪：回傳既有時間戳（冪等）。
  const existing = await db.query.spaces.findFirst({ where: eq(spaces.id, spaceId) });
  if (!existing?.deletedAt) throw new Error("NOT_FOUND");
  return existing.deletedAt;
}

export interface RestoredSpace {
  slug: string;
  name: string;
}

/**
 * 還原軟刪 Space（清除 deleted_at）。僅允許保留期內（deleted_at ≥ now − 保留天數）還原；
 * 已逾期（等待 cron 清除）或不存在一律擲 NOT_FOUND。回傳還原後的 slug／name 供 UI 提示。
 */
export async function restoreSpace(
  spaceId: string,
  retentionDays: number = SPACE_TRASH_RETENTION_DAYS,
): Promise<RestoredSpace> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const [row] = await db
    .update(spaces)
    .set({ deletedAt: null })
    .where(and(eq(spaces.id, spaceId), isNotNull(spaces.deletedAt), gte(spaces.deletedAt, cutoff)))
    .returning({ slug: spaces.slug, name: spaces.name });
  if (!row) throw new Error("NOT_FOUND");
  return row;
}

export interface DeletedSpaceRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  deletedAt: Date;
}

/**
 * 列出保留期內、可還原的軟刪 Space（deleted_at 由新到舊）。逾期（等待 cron 清除）者不列出。
 * 純資料存取，不做權限判斷——呼叫端（/admin 頁）須先 assertOrgAdmin。
 */
export async function listDeletedSpaces(
  retentionDays: number = SPACE_TRASH_RETENTION_DAYS,
): Promise<DeletedSpaceRow[]> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: spaces.id,
      slug: spaces.slug,
      name: spaces.name,
      icon: spaces.icon,
      deletedAt: spaces.deletedAt,
    })
    .from(spaces)
    .where(and(isNotNull(spaces.deletedAt), gte(spaces.deletedAt, cutoff)))
    .orderBy(desc(spaces.deletedAt));
  return rows.map((r) => ({ ...r, deletedAt: r.deletedAt as Date }));
}

/**
 * 永久清除逾期軟刪 Space（worker cron，purge-trash 併跑）。硬刪 deleted_at 早於
 * (now − retentionDays) 的 space；FK cascade 連帶清除其頁面（及版本／向量／留言）、
 * 成員、釘選、附件。回傳清除筆數。
 */
export async function purgeExpiredSpaces(
  retentionDays: number = SPACE_TRASH_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const purged = await db
    .delete(spaces)
    .where(and(isNotNull(spaces.deletedAt), lt(spaces.deletedAt, cutoff)))
    .returning({ id: spaces.id });
  if (purged.length > 0) {
    await writeAudit({
      action: "space.purge_expired",
      targetType: "space",
      metadata: {
        purgedCount: purged.length,
        retentionDays,
        cutoff: cutoff.toISOString(),
      },
    });
    logger.info({ purged: purged.length, retentionDays }, "expired soft-deleted spaces purged");
  }
  return purged.length;
}
