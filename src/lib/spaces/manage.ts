import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaceMembers, spaces, users, type SpaceRole } from "@/lib/db/schema";

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
