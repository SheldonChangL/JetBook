import "server-only";
import { and, desc, ilike, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { getAccessiblePageIds, type Actor } from "@/lib/authz/permission";

/** 可插入頁面連結的候選頁（suggestion 顯示與插入用）。 */
export interface LinkablePage {
  id: string;
  title: string;
  slug: string;
}

const DEFAULT_LIMIT = 8;

/**
 * 搜尋可於指定 Space 內建立內部連結的頁面（D-11，F-EDIT-12）。
 *
 * 權限：先取使用者可讀的 pageId 集合（`getAccessiblePageIds`，SQL 層過濾，架構鐵律 #2），
 * 再於該集合內以標題 ILIKE 收斂——絕不「先撈全部標題再過濾」。限定當前 Space
 * （編輯情境下最常連結同 Space 頁面），未刪除者。回傳現行 slug/title（插入時的快照）。
 */
export async function searchLinkablePages(
  user: Actor,
  spaceId: string,
  query: string,
  limit: number = DEFAULT_LIMIT,
): Promise<LinkablePage[]> {
  const accessibleIds = await getAccessiblePageIds(user, spaceId);
  if (accessibleIds.length === 0) return [];

  const q = query.trim();
  const conditions = [inArray(pages.id, accessibleIds)];
  if (q) conditions.push(ilike(pages.title, `%${q}%`));

  const rows = await db
    .select({ id: pages.id, title: pages.title, slug: pages.slug })
    .from(pages)
    .where(and(...conditions))
    .orderBy(desc(pages.updatedAt))
    .limit(Math.min(limit, 20));

  return rows;
}
