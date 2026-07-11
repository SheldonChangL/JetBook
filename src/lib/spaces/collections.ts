import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { collections, spaces } from "@/lib/db/schema";

/**
 * Collection（Space 分組）商業邏輯（C-09，F-ORG-03）。
 * 權限斷言在 action 薄殼層（assertOrgAdmin：org admin 管 collection）；此層只做資料規則，
 * 抽出至 lib 以符合薄殼原則並可用真 PG 直接驗證。
 *
 * v1 範圍為「分組顯示」：collection 為 Space 的平面分組容器（schema 保留 parent_id 供日後巢狀）。
 * F-ORG-03 驗收 (2)「權限向下繼承／覆寫」列 M4 backlog，v1 不實作繼承。
 */

export interface CollectionRow {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
}

const collectionColumns = {
  id: collections.id,
  name: collections.name,
  parentId: collections.parentId,
  position: collections.position,
} as const;

/** 列出所有 collection（position → name 排序），供分組標頭與指派下拉使用。 */
export async function listCollections(): Promise<CollectionRow[]> {
  return db
    .select(collectionColumns)
    .from(collections)
    .orderBy(asc(collections.position), asc(collections.name));
}

/** 建立 collection；position 取現有最大值 +1（附加在末尾）。 */
export async function createCollection(name: string): Promise<CollectionRow> {
  return db.transaction(async (tx) => {
    const [agg] = await tx
      .select({ next: sql<number>`coalesce(max(${collections.position}) + 1, 0)` })
      .from(collections);
    const [row] = await tx
      .insert(collections)
      .values({ name, position: agg?.next ?? 0 })
      .returning(collectionColumns);
    if (!row) throw new Error("collection 建立失敗");
    return row;
  });
}

/** 重新命名 collection；不存在擲 NOT_FOUND。 */
export async function renameCollection(id: string, name: string): Promise<void> {
  const [row] = await db
    .update(collections)
    .set({ name })
    .where(eq(collections.id, id))
    .returning({ id: collections.id });
  if (!row) throw new Error("NOT_FOUND");
}

/**
 * 刪除 collection；不存在擲 NOT_FOUND。
 * 其中的 Space 由 FK（spaces.collection_id onDelete: set null）自動變為未分組，
 * Space 本身與內容不受影響。
 */
export async function deleteCollection(id: string): Promise<void> {
  const [row] = await db
    .delete(collections)
    .where(eq(collections.id, id))
    .returning({ id: collections.id });
  if (!row) throw new Error("NOT_FOUND");
}

/**
 * 指派／移除 Space 的所屬 collection（下拉或拖曳）。collectionId=null 移出分組。
 * 目標 collection 不存在擲 COLLECTION_NOT_FOUND；Space 不存在擲 SPACE_NOT_FOUND。
 */
export async function assignSpaceCollection(
  spaceId: string,
  collectionId: string | null,
): Promise<void> {
  if (collectionId) {
    const target = await db.query.collections.findFirst({
      where: eq(collections.id, collectionId),
    });
    if (!target) throw new Error("COLLECTION_NOT_FOUND");
  }
  const [row] = await db
    .update(spaces)
    .set({ collectionId })
    .where(eq(spaces.id, spaceId))
    .returning({ id: spaces.id });
  if (!row) throw new Error("SPACE_NOT_FOUND");
}
