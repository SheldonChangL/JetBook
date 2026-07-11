import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, spaces } from "@/lib/db/schema";
import { filterReadablePageIds, type Actor } from "@/lib/authz/permission";

/** 解析後的頁面連結目標（閱讀渲染用）。 */
export interface ResolvedPageLink {
  /** 站內相對路徑（現行 slug；改名自動更新，F-EDIT-12） */
  href: string;
  /** 現行標題（改名自動更新） */
  title: string;
}

/**
 * 依 page id 批次解析頁面連結目標的「現行」slug/title（D-11，F-EDIT-12）。
 *
 * 改名不失效：canonical 錨在 page id，此處查現行 slug/title，故連結文字與 URL 隨改名更新。
 * 權限：只解析「檢視者可讀」的目標（`getAccessiblePageIds`，SQL 層過濾，架構鐵律 #2）——
 * 不可讀或已刪除的目標不納入回傳 Map；渲染端據此改用作者插入時的 label 快照顯示（不連結、
 * 不洩漏改名後標題）。回傳 Map<pageId, ResolvedPageLink>。
 */
export async function resolvePageLinkTargets(
  user: Actor,
  pageIds: string[],
): Promise<Map<string, ResolvedPageLink>> {
  const result = new Map<string, ResolvedPageLink>();
  const unique = [...new Set(pageIds)].filter((id) => id.length > 0);
  if (unique.length === 0) return result;

  // 權限：只保留檢視者可讀的目標（getAccessiblePageIds 於 SQL 層過濾，架構鐵律 #2）。
  const readable = await filterReadablePageIds(user, unique);
  if (readable.length === 0) return result;

  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      spaceSlug: spaces.slug,
    })
    .from(pages)
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .where(and(inArray(pages.id, readable), isNull(pages.deletedAt)));

  for (const row of rows) {
    result.set(row.id, {
      href: `/s/${row.spaceSlug}/${row.slug}`,
      title: row.title,
    });
  }
  return result;
}
