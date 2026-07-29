import { describe, expect, it } from "vitest";
import {
  MAX_AUTO_EXPANDED_ROWS,
  collectParentIds,
  computeInitialExpanded,
  type ExpansionNode,
} from "./tree-expansion";

/** 依 `id: parentId` 對照表建節點清單（`null` ＝ 根層）。 */
const tree = (spec: Record<string, string | null>): ExpansionNode[] =>
  Object.entries(spec).map(([id, parentId]) => ({ id, parentId }));

/** 產生一條 `count` 個根節點、每個帶 `childrenEach` 個子節點的樹。 */
function wideTree(count: number, childrenEach: number): ExpansionNode[] {
  const nodes: ExpansionNode[] = [];
  for (let i = 0; i < count; i += 1) {
    nodes.push({ id: `r${i}`, parentId: null });
    for (let c = 0; c < childrenEach; c += 1) {
      nodes.push({ id: `r${i}-c${c}`, parentId: `r${i}` });
    }
  }
  return nodes;
}

describe("collectParentIds", () => {
  it("只收有子節點的 id，忽略指向集合外的 parentId", () => {
    const nodes = tree({ a: null, b: "a", orphan: "missing" });
    expect(collectParentIds(nodes)).toEqual(new Set(["a"]));
  });
});

describe("computeInitialExpanded", () => {
  it("空樹回空集合", () => {
    expect(computeInitialExpanded([], null).size).toBe(0);
  });

  it("小樹首繪即整棵展開（＝使用者無需互動就看到層級）", () => {
    const nodes = tree({ a: null, b: "a", c: "b", d: null });
    expect(computeInitialExpanded(nodes, null)).toEqual(new Set(["a", "b"]));
  });

  it("超過列數上限即停在放得下的那層，同層兄弟一致展開", () => {
    // 6 根 × 4 子 ＝ 深度 0 有 6 列、深度 1 有 24 列；展開第一層共 30 列 > 24 ⇒ 全部維持收合
    const nodes = wideTree(6, 4);
    expect(computeInitialExpanded(nodes, null).size).toBe(0);

    // 4 根 × 5 子 ＝ 4 + 20 ＝ 24 列，正好等於上限 ⇒ 第一層全展
    const fits = wideTree(4, 5);
    expect(computeInitialExpanded(fits, null)).toEqual(new Set(["r0", "r1", "r2", "r3"]));
  });

  it("第二層放不下時只展第一層，不會半開", () => {
    // 深度 0：2 列；深度 1：2 列；深度 2：22 列 ⇒ 展到深度 1 共 4 列可以，再一層 26 列超過
    const nodes: ExpansionNode[] = [
      { id: "r0", parentId: null },
      { id: "r1", parentId: null },
      { id: "r0-c", parentId: "r0" },
      { id: "r1-c", parentId: "r1" },
    ];
    for (let i = 0; i < 11; i += 1) {
      nodes.push({ id: `r0-c-g${i}`, parentId: "r0-c" });
      nodes.push({ id: `r1-c-g${i}`, parentId: "r1-c" });
    }
    expect(computeInitialExpanded(nodes, null)).toEqual(new Set(["r0", "r1"]));
  });

  it("即使超過上限，當前頁的祖先鏈仍必展", () => {
    const nodes = wideTree(6, 4);
    nodes.push({ id: "deep", parentId: "r5-c3" });
    const expanded = computeInitialExpanded(nodes, "deep");
    expect(expanded).toEqual(new Set(["r5", "r5-c3"]));
  });

  it("當前頁本身有子節點時一併展開（點父頁即揭露下一層）", () => {
    const nodes = wideTree(6, 4);
    const expanded = computeInitialExpanded(nodes, "r2");
    expect(expanded).toEqual(new Set(["r2"]));
  });

  it("當前頁為葉節點時不會多展開自己", () => {
    const nodes = wideTree(6, 4);
    expect(computeInitialExpanded(nodes, "r2-c1")).toEqual(new Set(["r2"]));
  });

  it("當前頁不在樹內時忽略", () => {
    const nodes = wideTree(6, 4);
    expect(computeInitialExpanded(nodes, "not-in-tree").size).toBe(0);
  });

  it("parentId 成環不會無限迴圈", () => {
    const nodes = tree({ a: "b", b: "a" });
    expect(() => computeInitialExpanded(nodes, "a")).not.toThrow();
  });

  it("maxRows 可覆寫（預設為 MAX_AUTO_EXPANDED_ROWS）", () => {
    const nodes = wideTree(4, 5);
    expect(MAX_AUTO_EXPANDED_ROWS).toBe(24);
    expect(computeInitialExpanded(nodes, null, 10).size).toBe(0);
  });
});
