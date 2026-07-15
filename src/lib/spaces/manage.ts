import "server-only";
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  groupMembers,
  groups,
  spaceMemberGroups,
  spaceMembers,
  spaces,
  users,
  type SpaceRole,
  type SpaceVisibility,
} from "@/lib/db/schema";
import { highestRole } from "@/lib/authz/policy";
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

/** 以 email 找啟用中使用者（API 加成員用，大小寫不敏感）；查無回 null。 */
export async function findActiveUserByEmail(email: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = lower(${email})`, eq(users.isActive, true)))
    .limit(1);
  return row ?? null;
}

export interface SpaceUpdateFields {
  name?: string;
  description?: string | null;
  icon?: string | null;
  visibility?: SpaceVisibility;
}

/**
 * 更新 space 欄位（名稱／描述／icon／可見度）——web action 與 API 寫入共用的唯一更新路徑，
 * 只寫入有提供的欄位（description／icon 可設 null 清除）。權限斷言與稽核由呼叫端薄殼負責。
 */
export async function updateSpaceFields(spaceId: string, fields: SpaceUpdateFields): Promise<void> {
  await db.update(spaces).set(fields).where(eq(spaces.id, spaceId));
}

// ── 群組掛載（K-03 主體泛化 C5） ─────────────────────────────────────

export interface SpaceGroupRow {
  groupId: string;
  name: string;
  role: SpaceRole;
  memberCount: number;
  createdAt: Date;
}

/** 列出掛在某 space 的群組（含群組成員數）供設定頁管理，依群組名稱排序。 */
export async function listSpaceGroups(spaceId: string): Promise<SpaceGroupRow[]> {
  const rows = await db
    .select({
      groupId: spaceMemberGroups.groupId,
      name: groups.name,
      role: spaceMemberGroups.role,
      createdAt: spaceMemberGroups.createdAt,
      memberCount: count(groupMembers.userId),
    })
    .from(spaceMemberGroups)
    .innerJoin(groups, eq(groups.id, spaceMemberGroups.groupId))
    .leftJoin(groupMembers, eq(groupMembers.groupId, spaceMemberGroups.groupId))
    .where(eq(spaceMemberGroups.spaceId, spaceId))
    .groupBy(spaceMemberGroups.groupId, groups.name, spaceMemberGroups.role, spaceMemberGroups.createdAt)
    .orderBy(asc(groups.name));
  return rows.map((r) => ({ ...r, memberCount: Number(r.memberCount) }));
}

export interface SpaceGroupMemberRow {
  userId: string;
  name: string;
  email: string;
  /** 經群組繼承的有效角色（多群組取最高） */
  role: SpaceRole;
  /** 來源群組名稱（可能多個） */
  groupNames: string[];
}

/**
 * 列出「僅經由群組」而成為 space 成員的使用者（排除同時為直接成員者，避免與直接成員列重複）。
 * 有效角色＝各來源群組角色取最高（highestRole）。供成員表格「來源：經由群組」badge。
 */
export async function listSpaceGroupMembers(spaceId: string): Promise<SpaceGroupMemberRow[]> {
  const rows = await db.execute<{
    user_id: string;
    name: string;
    email: string;
    group_names: string[];
    roles: SpaceRole[];
  }>(sql`
    select gm.user_id, u.name, u.email,
           array_agg(distinct g.name order by g.name) as group_names,
           -- role 為自訂 enum 陣列，node-postgres 不會自動解析，明確轉 text[] 供 JS 端讀取
           array_agg(distinct smg.role::text) as roles
    from ${spaceMemberGroups} smg
      join ${groups} g on g.id = smg.group_id
      join ${groupMembers} gm on gm.group_id = smg.group_id
      join ${users} u on u.id = gm.user_id
    where smg.space_id = ${spaceId}
      and not exists (
        select 1 from ${spaceMembers} sm
        where sm.space_id = smg.space_id and sm.user_id = gm.user_id
      )
    group by gm.user_id, u.name, u.email
    order by u.name
  `);
  return rows.rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    groupNames: r.group_names,
    role: highestRole(r.roles) ?? "viewer",
  }));
}

/**
 * 掛載／變更／移除群組於某 space。role=null 移除掛載。
 * 冪等：同一 (space, group) 以最新角色覆寫。
 */
export async function setSpaceGroupRole(
  spaceId: string,
  groupId: string,
  role: SpaceRole | null,
): Promise<void> {
  if (role === null) {
    await db
      .delete(spaceMemberGroups)
      .where(and(eq(spaceMemberGroups.spaceId, spaceId), eq(spaceMemberGroups.groupId, groupId)));
    return;
  }
  await db
    .insert(spaceMemberGroups)
    .values({ spaceId, groupId, role })
    .onConflictDoUpdate({
      target: [spaceMemberGroups.spaceId, spaceMemberGroups.groupId],
      set: { role },
    });
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
