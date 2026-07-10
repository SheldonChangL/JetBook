import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
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
 */
export async function listSpaceTreeNodes(spaceId: string): Promise<SpaceTreeNode[]> {
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
    .orderBy(asc(pages.position));
}
