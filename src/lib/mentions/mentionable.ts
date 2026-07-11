import "server-only";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaceMembers, spaces, users } from "@/lib/db/schema";

/** @mention 候選人（suggestion 顯示與插入用）。 */
export interface MentionableUser {
  id: string;
  name: string;
  email: string;
}

/** 單次 suggestion 回傳上限（浮動面板只需少量候選）。 */
const DEFAULT_LIMIT = 8;

/**
 * 搜尋可於指定 Space 被 @mention 的使用者（D-11，K-02）。
 *
 * 「可被提及」＝「對該 Space 有讀取權」，與 authz 讀取邏輯一致（架構鐵律 #1、#2）：
 *   - org_read / org_write：全體在職使用者皆可讀 → 皆可提及。
 *   - 其餘（private）：Space 成員，外加 org admin（其對所有 space 有讀取權）。
 * 於 SQL 層以可讀條件過濾，不做「先全撈再過濾」，避免把無讀取權者列為候選。
 * 呼叫端（server action）須先驗 session 與 page.edit；本函式只負責候選查詢。
 */
export async function searchMentionableUsers(
  spaceId: string,
  query: string,
  limit: number = DEFAULT_LIMIT,
): Promise<MentionableUser[]> {
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, spaceId) });
  if (!space || space.deletedAt) return [];

  const orgReadable = space.visibility === "org_read" || space.visibility === "org_write";

  // 可讀條件：org 可見 → 全員；否則 Space 成員 或 org admin。
  const readableCondition = orgReadable
    ? sql`true`
    : sql`(
        ${users.orgRole} = 'admin'
        or exists (
          select 1 from ${spaceMembers} sm
          where sm.space_id = ${spaceId} and sm.user_id = ${users.id}
        )
      )`;

  const q = query.trim();
  const matchCondition = q
    ? or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`))
    : undefined;

  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.isActive, true), readableCondition, matchCondition))
    .orderBy(users.name)
    .limit(Math.min(limit, 20));

  return rows;
}
