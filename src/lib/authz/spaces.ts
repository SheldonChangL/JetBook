import "server-only";
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  groupMembers,
  spaceMemberGroups,
  spaceMembers,
  spaces,
  type SpaceRole,
  type User,
} from "@/lib/db/schema";
import { highestRole, roleAtLeast } from "./policy";

export { roleAtLeast };

/**
 * Space 層級授權（B-03 permission.ts 的一部分；權限判斷集中在 lib/authz）。
 * 解析：org admin 全通 → 顯式角色（直接成員或群組成員取最高，K-03 主體泛化 C5）
 * → visibility（org_read/org_write 全員可讀）→ 預設拒絕。
 */

/**
 * 「使用者經群組掛載而為某 space 成員」的 SQL exists 片段（K-03）。
 * `spaceIdExpr` 為外層 space id 欄位表達式；roleFilter 可選（限定 group 掛載角色）。
 */
export function userInSpaceViaGroup(
  userId: string,
  spaceIdExpr: SQL,
  roleFilter?: SQL,
): SQL {
  return sql`exists (
    select 1 from ${spaceMemberGroups} smg
    join ${groupMembers} gm on gm.group_id = smg.group_id
    where smg.space_id = ${spaceIdExpr} and gm.user_id = ${userId}
      ${roleFilter ? roleFilter : sql``}
  )`;
}

/** 可讀 Space 的 SQL 條件（未封存、未刪除，且 org_read/org_write 或本人為成員／群組成員）。 */
export function accessibleSpaceCondition(user: Pick<User, "id" | "orgRole">) {
  const base = and(isNull(spaces.archivedAt), isNull(spaces.deletedAt));
  if (user.orgRole === "admin") return base;
  return and(
    base,
    or(
      sql`${spaces.visibility} in ('org_read', 'org_write')`,
      sql`exists (select 1 from ${spaceMembers} sm where sm.space_id = ${spaces.id} and sm.user_id = ${user.id})`,
      userInSpaceViaGroup(user.id, sql`${spaces.id}`),
    ),
  );
}

/**
 * 取得使用者對某 space 的所有「顯式」角色（直接成員 ＋ 各群組來源角色）。
 * 供 resolveSpaceAccess 以 highestRole 取最高有效角色（K-03）。
 */
async function explicitSpaceRoles(userId: string, spaceId: string): Promise<SpaceRole[]> {
  const rows = await db.execute<{ role: SpaceRole }>(sql`
    select sm.role from ${spaceMembers} sm
      where sm.space_id = ${spaceId} and sm.user_id = ${userId}
    union all
    select smg.role from ${spaceMemberGroups} smg
      join ${groupMembers} gm on gm.group_id = smg.group_id
      where smg.space_id = ${spaceId} and gm.user_id = ${userId}
  `);
  return rows.rows.map((r) => r.role);
}

export interface SpaceAccess {
  /** 使用者對該 space 的有效角色；無權限或 space 已軟刪回 null。 */
  role: SpaceRole | null;
  /** space 是否已封存（唯讀）；已軟刪（role=null）時視為 false。 */
  archived: boolean;
}

/**
 * 一次取得使用者對某 Space 的有效角色與封存狀態（單次 space 查詢，供 can() 同時判角色與唯讀）。
 * 已軟刪 space 一律 role=null（不可存取）。
 */
export async function resolveSpaceAccess(
  user: Pick<User, "id" | "orgRole">,
  spaceId: string,
): Promise<SpaceAccess> {
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, spaceId) });
  if (!space || space.deletedAt) return { role: null, archived: false };

  const archived = space.archivedAt !== null;

  if (user.orgRole === "admin") return { role: "admin", archived };

  // 顯式角色（直接成員 ＋ 群組來源）取最高（K-03 主體泛化 C5）。
  const explicit = highestRole(await explicitSpaceRoles(user.id, spaceId));
  if (explicit) return { role: explicit, archived };

  // 無任何顯式角色：依可見性給隱含角色
  if (space.visibility === "org_write") return { role: "editor", archived };
  if (space.visibility === "org_read") return { role: "viewer", archived };
  return { role: null, archived };
}

/** 取得使用者對某 Space 的有效角色；無權限回 null。 */
export async function getSpaceRole(
  user: Pick<User, "id" | "orgRole">,
  spaceId: string,
): Promise<SpaceRole | null> {
  return (await resolveSpaceAccess(user, spaceId)).role;
}

