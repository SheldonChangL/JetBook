import "server-only";
import { cache } from "react";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";

export interface SpaceTreeNode {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  icon: string | null;
}

/**
 * 讀取整棵 space 頁面樹（C-03）：未刪除、依 fractional position 排序的平面列表，
 * 由前端依 parentId 組裝成樹（鄰接表，ADR-001）。
 * 呼叫端（layout / server action）負責先驗 space 讀取權（lib/authz）。
 * React cache()：同一請求內 layout 與 page 重複呼叫只查一次 DB。
 */
export const listSpaceTreeNodes = cache(async (spaceId: string): Promise<SpaceTreeNode[]> => {
  return db
    .select({
      id: pages.id,
      parentId: pages.parentId,
      title: pages.title,
      slug: pages.slug,
      icon: pages.icon,
    })
    .from(pages)
    .where(and(eq(pages.spaceId, spaceId), isNull(pages.deletedAt)))
    // fractional index 為 base-62 位元組序鍵：必須 COLLATE "C" 排序（C-04 修正）
    .orderBy(asc(sql`${pages.position} COLLATE "C"`));
});
