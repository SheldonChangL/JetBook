import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, spaces } from "@/lib/db/schema";
import { accessibleSpaceCondition } from "@/lib/authz/spaces";
import { getEditableSpaceIds, type Actor } from "@/lib/authz/permission";

/**
 * 解析後的頁面連結目標（閱讀渲染用）。
 * - `resolved`：目標存在且可讀，渲染為正常連結（現行 slug/title，改名自動更新）。
 * - `deleted`：目標已刪除（回收桶或清除中），渲染為死鏈 chip（C-13，F-PAGE-08）。
 */
export type ResolvedPageLink =
  | {
      status: "resolved";
      /** 站內相對路徑（現行 slug；改名自動更新，F-EDIT-12） */
      href: string;
      /** 現行標題（改名自動更新） */
      title: string;
    }
  | {
      status: "deleted";
      /** 檢視者是否具還原權限（editor+）；true 才提供還原入口 */
      canRestore: boolean;
      /** 直達回收桶（限定該 space）還原的路徑；無還原權限為 null */
      trashHref: string | null;
    };

/**
 * 依 page id 批次解析頁面連結目標（D-11、F-EDIT-12、C-13）。一次查詢處理全部 pageId。
 *
 * 改名不失效：canonical 錨在 page id，此處查現行 slug/title，故連結文字與 URL 隨改名更新。
 * 死鏈標示（C-13）：目標已刪除（`deleted_at` 非空，仍在回收桶）者不從結果剔除，而以
 * `status: "deleted"` 回傳，渲染端據此顯示「已刪除頁面」chip；具還原權限者（editor+）
 * 附回收桶還原入口。
 *
 * 權限（架構鐵律 #1/#2）：只解析「檢視者可讀 space」內的目標——`accessibleSpaceCondition`
 * 於 SQL 層過濾（org admin／org_read/write／成員判定，與 getAccessiblePageIds 同源）。
 * 不可讀 space 的目標（含其刪除狀態）一律不納入回傳 Map，不洩漏存在性；渲染端退回作者
 * 插入時的 label 快照顯示（不連結）。還原權限沿用回收桶同一判定（`getEditableSpaceIds`）。
 *
 * 回傳 Map<pageId, ResolvedPageLink>。
 */
export async function resolvePageLinkTargets(
  user: Actor,
  pageIds: string[],
): Promise<Map<string, ResolvedPageLink>> {
  const result = new Map<string, ResolvedPageLink>();
  const unique = [...new Set(pageIds)].filter((id) => id.length > 0);
  if (unique.length === 0) return result;

  // 一次查全部 pageId，限定在檢視者可讀 space（SQL 層過濾）。此處「不」以 deleted_at 過濾——
  // 已刪目標需保留以渲染死鏈 chip，改由 row.deletedAt 分類。
  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      deletedAt: pages.deletedAt,
      spaceId: pages.spaceId,
      spaceSlug: spaces.slug,
    })
    .from(pages)
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .where(and(inArray(pages.id, unique), accessibleSpaceCondition(user)));

  // 還原權限（editor+）僅在確有已刪目標時才查（多數頁面無死鏈，省一次查詢）。
  const hasDeleted = rows.some((row) => row.deletedAt !== null);
  const editableSpaceIds = hasDeleted ? new Set(await getEditableSpaceIds(user)) : null;

  for (const row of rows) {
    if (row.deletedAt === null) {
      result.set(row.id, {
        status: "resolved",
        href: `/s/${row.spaceSlug}/${row.slug}`,
        title: row.title,
      });
    } else {
      const canRestore = editableSpaceIds?.has(row.spaceId) ?? false;
      result.set(row.id, {
        status: "deleted",
        canRestore,
        trashHref: canRestore ? `/trash?space=${row.spaceSlug}` : null,
      });
    }
  }
  return result;
}
