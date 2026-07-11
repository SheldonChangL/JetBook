/**
 * Space 依 Collection 分組的純函式（C-09，F-ORG-03）。
 * 不接觸 DB、不 server-only，供 RSC（spaces 頁、側欄）與單元測試共用。
 */

export interface CollectionRef {
  id: string;
  name: string;
}

export interface SpaceGroup<T> {
  /** 分組所屬 collection；null 代表「未分組」。 */
  collection: CollectionRef | null;
  spaces: T[];
}

/**
 * 將 Space 依 collection_id 分組。
 * - collections 依傳入順序輸出（呼叫端先以 position → name 排序）。
 * - collection_id 為 null、或指向不在 `collections` 內（不存在／使用者不可見）者，
 *   一律歸入「未分組」並排在最後。
 * - `includeEmpty=false`（預設，一般使用者視角）略過沒有任何 space 的 collection；
 *   `true`（org admin 管理視角）保留空 collection 以便指派。
 */
export function groupSpacesByCollection<T extends { collectionId: string | null }>(
  spaceList: T[],
  collections: CollectionRef[],
  options: { includeEmpty?: boolean } = {},
): SpaceGroup<T>[] {
  const byCollection = new Map<string, T[]>();
  const ungrouped: T[] = [];
  const known = new Map(collections.map((c) => [c.id, c] as const));

  for (const space of spaceList) {
    const collectionId = space.collectionId;
    if (collectionId && known.has(collectionId)) {
      const existing = byCollection.get(collectionId);
      if (existing) existing.push(space);
      else byCollection.set(collectionId, [space]);
    } else {
      ungrouped.push(space);
    }
  }

  const groups: SpaceGroup<T>[] = [];
  for (const collection of collections) {
    const list = byCollection.get(collection.id) ?? [];
    if (list.length === 0 && !options.includeEmpty) continue;
    groups.push({ collection: { id: collection.id, name: collection.name }, spaces: list });
  }
  if (ungrouped.length > 0) {
    groups.push({ collection: null, spaces: ungrouped });
  }
  return groups;
}
