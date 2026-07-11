import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, spaceMembers, spaces, type SpaceRole, type User } from "@/lib/db/schema";
import { getSpaceRole } from "./spaces";
import { actionAllowedForRole, roleAtLeast, type Action } from "./policy";

/**
 * 權限判斷唯一入口（架構鐵律 #1）。UI／Server Action／Route Handler／RSC
 * 一律呼叫 can() 或 getAccessiblePageIds()，禁止散寫權限邏輯。權限預設拒絕。
 *
 * 解析順序（見 ADR / system-architecture B.6）：
 *   org admin 全通 → 頁面 restricted 時查 page_permissions（後續 issue）→
 *   繼承 space 角色（成員或 group 成員，C5）→ visibility 隱含角色 → 預設拒絕。
 */

export type Resource =
  | { type: "space"; spaceId: string }
  | { type: "page"; spaceId: string; restricted?: boolean };

export type Actor = Pick<User, "id" | "orgRole">;

export { actionAllowedForRole };
export type { Action };

/** 集中式權限判斷。預設拒絕。 */
export async function can(user: Actor, action: Action, resource: Resource): Promise<boolean> {
  const role = await getSpaceRole(user, resource.spaceId);
  return actionAllowedForRole(action, role);
}

/** 組織層級管理權（管理後台／使用者管理入口，L-01）。 */
export function isOrgAdmin(user: Actor): boolean {
  return user.orgRole === "admin";
}

/** 斷言版本：非 org admin 即擲 FORBIDDEN（admin action 薄殼使用）。 */
export function assertOrgAdmin(user: Actor): void {
  if (!isOrgAdmin(user)) {
    throw new Error("FORBIDDEN");
  }
}

/** 斷言版本：無權限即擲 FORBIDDEN（供 action/route handler 薄殼使用）。 */
export async function assertCan(user: Actor, action: Action, resource: Resource): Promise<void> {
  if (!(await can(user, action, resource))) {
    throw new Error("FORBIDDEN");
  }
}

/**
 * 取得使用者可讀的頁面 id 集合——RAG／搜尋在 SQL 層 join 過濾用（架構鐵律 #2、N-04）。
 * 一律以「可讀 space 條件」在 DB 端過濾，不做「先取回再過濾」。
 * @param spaceId 限定單一 space（可選）
 * @param options.requireAiIndexing 只納入 ai_indexing_enabled=true 的 space（RAG 用，NFR-COMP-03）
 */
export async function getAccessiblePageIds(
  user: Actor,
  spaceId?: string,
  options: { requireAiIndexing?: boolean } = {},
): Promise<string[]> {
  const accessibleSpaceIds = sql`
    select s.id from ${spaces} s
    where s.archived_at is null and s.deleted_at is null
      ${options.requireAiIndexing ? sql`and s.ai_indexing_enabled = true` : sql``}
      and (
        ${user.orgRole === "admin" ? sql`true` : sql`
          s.visibility in ('org_read', 'org_write')
          or exists (
            select 1 from ${spaceMembers} sm
            where sm.space_id = s.id and sm.user_id = ${user.id}
          )
        `}
      )
  `;

  const conditions = [
    isNull(pages.deletedAt),
    sql`${pages.spaceId} in (${accessibleSpaceIds})`,
  ];
  if (spaceId) conditions.push(eq(pages.spaceId, spaceId));

  const rows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(...conditions));
  return rows.map((r) => r.id);
}

/**
 * 取得使用者具「編輯者以上」角色（page.edit / page.delete 前提）的 space id 集合。
 * 回收桶還原（C-08）用：只列出／只允許還原使用者實際能編輯的 space 之已刪頁。
 * 解析與 getSpaceRole 一致：org admin 全通、org_write 隱含 editor、成員角色 editor/admin。
 * 排除封存與已刪除 space（與 getAccessiblePageIds 的可存取範圍一致）。
 */
export async function getEditableSpaceIds(user: Actor): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select s.id from ${spaces} s
    where s.archived_at is null and s.deleted_at is null
      and (
        ${user.orgRole === "admin" ? sql`true` : sql`
          s.visibility = 'org_write'
          or exists (
            select 1 from ${spaceMembers} sm
            where sm.space_id = s.id and sm.user_id = ${user.id}
              and sm.role in ('editor', 'admin')
          )
        `}
      )
  `);
  return rows.rows.map((r) => r.id);
}

/** 頁面可讀性單點判斷（RSC 載入決定 404/403 用）。 */
export async function canReadPage(user: Actor, pageId: string): Promise<boolean> {
  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), isNull(pages.deletedAt)),
  });
  if (!page) return false;
  return can(user, "page.read", { type: "page", spaceId: page.spaceId });
}

/** 頁面可編輯性單點判斷（route handler 依此把關 page.edit，如編輯器 AI 輔助 I-08）。 */
export async function canEditPage(user: Actor, pageId: string): Promise<boolean> {
  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), isNull(pages.deletedAt)),
  });
  if (!page) return false;
  return can(user, "page.edit", { type: "page", spaceId: page.spaceId });
}

/** 批次過濾：從一組 pageId 篩出可讀者（保序）。 */
export async function filterReadablePageIds(user: Actor, pageIds: string[]): Promise<string[]> {
  if (pageIds.length === 0) return [];
  const accessible = new Set(await getAccessiblePageIds(user));
  return pageIds.filter((id) => accessible.has(id));
}

export { getSpaceRole, roleAtLeast };
export type { SpaceRole };
