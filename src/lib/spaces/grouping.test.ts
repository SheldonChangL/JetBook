import { describe, expect, it } from "vitest";
import { groupSpacesByCollection, type CollectionRef } from "./grouping";

/** C-09 Collection 分組純函式單元測試（F-ORG-03 分組顯示）。 */

interface S {
  id: string;
  collectionId: string | null;
}

const collections: CollectionRef[] = [
  { id: "c1", name: "研發" },
  { id: "c2", name: "行銷" },
];

describe("groupSpacesByCollection", () => {
  it("依 collections 傳入順序分組，未分組排在最後", () => {
    const spaces: S[] = [
      { id: "s1", collectionId: "c2" },
      { id: "s2", collectionId: "c1" },
      { id: "s3", collectionId: null },
      { id: "s4", collectionId: "c1" },
    ];
    const groups = groupSpacesByCollection(spaces, collections);
    expect(groups.map((g) => g.collection?.id ?? "none")).toEqual(["c1", "c2", "none"]);
    expect(groups[0]?.spaces.map((s) => s.id)).toEqual(["s2", "s4"]);
    expect(groups[1]?.spaces.map((s) => s.id)).toEqual(["s1"]);
    expect(groups[2]?.spaces.map((s) => s.id)).toEqual(["s3"]);
  });

  it("預設略過空 collection；includeEmpty=true 時保留", () => {
    const spaces: S[] = [{ id: "s1", collectionId: "c1" }];
    expect(groupSpacesByCollection(spaces, collections).map((g) => g.collection?.id)).toEqual([
      "c1",
    ]);
    expect(
      groupSpacesByCollection(spaces, collections, { includeEmpty: true }).map(
        (g) => g.collection?.id,
      ),
    ).toEqual(["c1", "c2"]);
  });

  it("collection_id 指向未知（不可見/已刪）的 collection 視為未分組", () => {
    const spaces: S[] = [{ id: "s1", collectionId: "ghost" }];
    const groups = groupSpacesByCollection(spaces, collections);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.collection).toBeNull();
    expect(groups[0]?.spaces.map((s) => s.id)).toEqual(["s1"]);
  });

  it("沒有未分組空間時不輸出未分組群", () => {
    const spaces: S[] = [{ id: "s1", collectionId: "c1" }];
    const groups = groupSpacesByCollection(spaces, collections);
    expect(groups.some((g) => g.collection === null)).toBe(false);
  });

  it("空輸入回傳空陣列", () => {
    expect(groupSpacesByCollection([], collections)).toEqual([]);
    expect(groupSpacesByCollection([], collections, { includeEmpty: true })).toEqual([
      { collection: { id: "c1", name: "研發" }, spaces: [] },
      { collection: { id: "c2", name: "行銷" }, spaces: [] },
    ]);
  });
});
