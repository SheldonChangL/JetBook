/**
 * 頁面樹展開規則（#286）。
 *
 * 純函式、不依賴 DOM 與 DB：頁面樹 client 元件首繪（SSR 與 CSR 必須得到相同結果）
 * 與單元測試共用。側欄的展開控制對第一次使用者不夠明顯，因此首繪即把結構攤開，
 * 讓「已展開／已收合」兩種狀態自己說明 chevron 的用途。
 */

/** 展開計算只需要鄰接關係；與 PageTreeNode 的其餘欄位無關。 */
export interface ExpansionNode {
  id: string;
  parentId: string | null;
}

/**
 * 首繪自動展開的可見列數上限。
 * 260px 側欄列高 34px＋列距 2px，900px 視窗的樹區約容納 22 列；取 24 容許輕微捲動，
 * 超過即停止展開下一層，避免大型空間一進來就洗掉整個側欄。
 */
export const MAX_AUTO_EXPANDED_ROWS = 24;

/** 某節點的深度（根＝0）。父節點不存在或成環時視為根層，避免無限迴圈。 */
function depthOf(id: string, byId: Map<string, ExpansionNode>): number {
  let depth = 0;
  let node = byId.get(id);
  const seen = new Set<string>([id]);
  while (node?.parentId && !seen.has(node.parentId)) {
    const parent = byId.get(node.parentId);
    if (!parent) break;
    seen.add(parent.id);
    depth += 1;
    node = parent;
  }
  return depth;
}

/** 全部「有子節點」的節點 id（＝可展開的節點）；供「全部展開」與展開狀態判斷使用。 */
export function collectParentIds(nodes: readonly ExpansionNode[]): Set<string> {
  const ids = new Set<string>(nodes.map((n) => n.id));
  const parents = new Set<string>();
  for (const n of nodes) {
    if (n.parentId !== null && ids.has(n.parentId)) parents.add(n.parentId);
  }
  return parents;
}

/**
 * 首繪的初始展開集合：
 *
 * 1. **逐層展開**：展開深度 ≤ L 的全部父節點，等於讓深度 ≤ L+1 的節點全部可見。
 *    取最大的 L 使可見列數不超過 `maxRows`。以「整層」為單位，同層兄弟一致展開，
 *    不會出現半開的層。
 * 2. **當前頁一律可見**：其祖先鏈必展（即使因此超過 `maxRows`）；當前頁本身有子節點時
 *    也一併展開——使用者點父頁的自然動作就會揭露下一層。
 */
export function computeInitialExpanded(
  nodes: readonly ExpansionNode[],
  currentId: string | null,
  maxRows: number = MAX_AUTO_EXPANDED_ROWS,
): Set<string> {
  const expanded = new Set<string>();
  if (nodes.length === 0) return expanded;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parents = collectParentIds(nodes);

  const depths = new Map<string, number>();
  const countByDepth: number[] = [];
  for (const n of nodes) {
    const depth = depthOf(n.id, byId);
    depths.set(n.id, depth);
    countByDepth[depth] = (countByDepth[depth] ?? 0) + 1;
  }

  let visible = countByDepth[0] ?? 0;
  /** 已接受展開的最深層；-1 ＝ 連第一層都放不下，全部維持收合 */
  let deepestExpandedLevel = -1;
  for (let depth = 1; depth < countByDepth.length; depth += 1) {
    const next = visible + (countByDepth[depth] ?? 0);
    if (next > maxRows) break;
    visible = next;
    deepestExpandedLevel = depth - 1;
  }
  if (deepestExpandedLevel >= 0) {
    for (const id of parents) {
      if ((depths.get(id) ?? 0) <= deepestExpandedLevel) expanded.add(id);
    }
  }

  if (currentId && byId.has(currentId)) {
    if (parents.has(currentId)) expanded.add(currentId);
    let node = byId.get(currentId);
    const seen = new Set<string>([currentId]);
    while (node?.parentId && !seen.has(node.parentId)) {
      const parent = byId.get(node.parentId);
      if (!parent) break;
      seen.add(parent.id);
      expanded.add(parent.id);
      node = parent;
    }
  }

  return expanded;
}
