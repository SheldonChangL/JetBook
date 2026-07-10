import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, pageVisits, spaces, users, type User } from "@/lib/db/schema";
import { accessibleSpaceCondition } from "@/lib/authz/spaces";

/**
 * Dashboard 查詢（C-06，設計規範 §3.2）。
 * 權限一律在 SQL 層 join `accessibleSpaceCondition` 過濾（架構鐵律 #2），
 * 不做「先取回再過濾」；已刪除頁面與封存/刪除 space 一併排除。
 */

type Actor = Pick<User, "id" | "orgRole">;

/** 「繼續閱讀」：本人最近瀏覽（page_visits join pages，預設 6 筆）。 */
export async function listRecentVisits(user: Actor, limit = 6) {
  return db
    .select({
      pageId: pages.id,
      title: pages.title,
      icon: pages.icon,
      slug: pages.slug,
      spaceSlug: spaces.slug,
      spaceName: spaces.name,
      visitedAt: pageVisits.visitedAt,
    })
    .from(pageVisits)
    .innerJoin(pages, eq(pages.id, pageVisits.pageId))
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .where(
      and(
        eq(pageVisits.userId, user.id),
        isNull(pages.deletedAt),
        accessibleSpaceCondition(user),
      ),
    )
    .orderBy(desc(pageVisits.visitedAt))
    .limit(limit);
}

/** 「最近更新」：可讀頁面依 updatedAt 倒序（預設 8 筆，含 space 與更新者）。 */
export async function listRecentlyUpdated(user: Actor, limit = 8) {
  return db
    .select({
      pageId: pages.id,
      title: pages.title,
      icon: pages.icon,
      slug: pages.slug,
      spaceSlug: spaces.slug,
      spaceName: spaces.name,
      updatedAt: pages.updatedAt,
      updatedByName: users.name,
    })
    .from(pages)
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .leftJoin(users, eq(users.id, pages.updatedBy))
    .where(and(isNull(pages.deletedAt), accessibleSpaceCondition(user)))
    .orderBy(desc(pages.updatedAt))
    .limit(limit);
}
