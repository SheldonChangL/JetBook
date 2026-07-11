import type { ProseMirrorDoc, ProseMirrorNode } from "./types";

/**
 * 版本差異比較純函式（E-04，F-VER-04）。
 *
 * 兩層 diff：
 *  1. 區塊級（block-level）：以「內容 hash 為 key」的 LCS 對齊兩版 doc 的頂層 block 序列，
 *     產出 equal / added / removed / modified 四種狀態。gap 內的 removed 與 added 依序配對成
 *     modified（同位置的區塊視為「修改」而非「刪除＋新增」）。
 *  2. 字級（char-level）：對 modified 區塊的純文字，以「單一 Unicode 字元為單位」做 LCS，
 *     產出 equal / insert / delete token（中文一字即一 token，符合「以字為單位」）。
 *
 * 全為純函式、無副作用；canonical 來源為 TipTap JSON（pages.content）。
 */

/** 區塊差異狀態。 */
export type BlockDiffStatus = "equal" | "added" | "removed" | "modified";

/** 字級差異 token 種類。 */
export type InlineDiffType = "equal" | "insert" | "delete";

/** 字級差異 token：一段連續同狀態文字。 */
export interface InlineDiffToken {
  type: InlineDiffType;
  text: string;
}

/** 單一頂層區塊的差異結果。 */
export interface BlockDiffEntry {
  status: BlockDiffStatus;
  /** 舊版區塊（removed / modified 有值；equal 亦帶舊值供對照）。 */
  oldBlock?: ProseMirrorNode;
  /** 新版區塊（added / modified / equal 有值）。 */
  newBlock?: ProseMirrorNode;
  /** 僅 modified：區塊內純文字的字級差異。 */
  inline?: InlineDiffToken[];
}

/**
 * 上限保護：block 內字級 LCS 為 O(m*n) 時間與空間，超大區塊（如巨型程式碼貼上）
 * 會拖垮渲染。乘積超過此值時退回「整段刪除＋整段新增」，不做字級對齊。
 */
const MAX_CHAR_DIFF_PRODUCT = 4_000_000;

/** 穩定序列化：遞迴排序物件 key，使等價節點得到相同字串（不受 key 順序影響）。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

/** 區塊內容 hash（相等即視為同一區塊）。 */
function blockKey(node: ProseMirrorNode): string {
  return stableStringify(node);
}

type DiffOp<T> =
  | { type: "equal"; oldItem: T; newItem: T }
  | { type: "delete"; oldItem: T }
  | { type: "insert"; newItem: T };

/**
 * 通用 LCS diff：回傳保序的 equal / delete / insert 操作序列。
 * tie-break 固定偏好 delete，使同一 gap 內恆為「先 delete 後 insert」，方便配對成 modified。
 */
function lcsDiff<T>(a: readonly T[], b: readonly T[], key: (item: T) => string): DiffOp<T>[] {
  const m = a.length;
  const n = b.length;
  const ka = a.map(key);
  const kb = b.map(key);

  // dp[i][j] = LCS 長度 of a[i..], b[j..]（索引皆在界內，斷言非空以滿足 noUncheckedIndexedAccess）
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = n - 1; j >= 0; j -= 1) {
      row[j] = ka[i] === kb[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }

  const ops: DiffOp<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (ka[i] === kb[j]) {
      ops.push({ type: "equal", oldItem: a[i]!, newItem: b[j]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "delete", oldItem: a[i]! });
      i += 1;
    } else {
      ops.push({ type: "insert", newItem: b[j]! });
      j += 1;
    }
  }
  while (i < m) {
    ops.push({ type: "delete", oldItem: a[i]! });
    i += 1;
  }
  while (j < n) {
    ops.push({ type: "insert", newItem: b[j]! });
    j += 1;
  }
  return ops;
}

/** 判斷節點是否為 inline 容器（其子節點串接不加分隔）。 */
function isInlineContainer(node: ProseMirrorNode): boolean {
  return node.type === "paragraph" || node.type === "heading" || node.type === "codeBlock";
}

/**
 * 抽取區塊的純文字（供字級 diff）。
 * inline 容器內串接不加分隔；block 容器子節點以換行分隔，保留可讀的結構界線。
 */
export function blockToText(node: ProseMirrorNode): string {
  if (typeof node.text === "string") return node.text;
  if (node.type === "hardBreak") return "\n";
  const children = node.content ?? [];
  if (children.length === 0) return "";
  return children.map((child) => blockToText(child)).join(isInlineContainer(node) ? "" : "\n");
}

/**
 * 字級差異：以單一 Unicode 字元（code point）為單位做 LCS。
 * 用擴展運算子切字，正確處理代理對；中文一字即一單位。
 * 連續同狀態合併成單一 token；LCS tie-break 使替換區恆為「先刪後增」。
 */
export function diffChars(oldText: string, newText: string): InlineDiffToken[] {
  if (oldText === newText) {
    return oldText.length > 0 ? [{ type: "equal", text: oldText }] : [];
  }
  const a = [...oldText];
  const b = [...newText];

  if (a.length * b.length > MAX_CHAR_DIFF_PRODUCT) {
    const tokens: InlineDiffToken[] = [];
    if (oldText.length > 0) tokens.push({ type: "delete", text: oldText });
    if (newText.length > 0) tokens.push({ type: "insert", text: newText });
    return tokens;
  }

  const ops = lcsDiff(a, b, (ch) => ch);
  const tokens: InlineDiffToken[] = [];
  for (const op of ops) {
    const type: InlineDiffType =
      op.type === "equal" ? "equal" : op.type === "delete" ? "delete" : "insert";
    const text = op.type === "insert" ? op.newItem : op.oldItem;
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) {
      last.text += text;
    } else {
      tokens.push({ type, text });
    }
  }
  return tokens;
}

/** 取 doc 的頂層 block 序列（缺內容視為空文件）。 */
function topLevelBlocks(doc: ProseMirrorDoc | null | undefined): ProseMirrorNode[] {
  return doc?.content ?? [];
}

/**
 * 區塊級差異：對齊兩版頂層 block 序列。
 * gap（非 equal 連續段）內先蒐集 removed 與 added，再依序配對成 modified；
 * 落單者為純 removed / added。modified 附帶區塊內字級 diff。
 */
export function diffDocs(
  oldDoc: ProseMirrorDoc | null | undefined,
  newDoc: ProseMirrorDoc | null | undefined,
): BlockDiffEntry[] {
  const oldBlocks = topLevelBlocks(oldDoc);
  const newBlocks = topLevelBlocks(newDoc);
  const ops = lcsDiff(oldBlocks, newBlocks, blockKey);

  const entries: BlockDiffEntry[] = [];
  let pendingRemoved: ProseMirrorNode[] = [];
  let pendingAdded: ProseMirrorNode[] = [];

  const flushGap = () => {
    const paired = Math.min(pendingRemoved.length, pendingAdded.length);
    for (let k = 0; k < paired; k += 1) {
      const oldBlock = pendingRemoved[k]!;
      const newBlock = pendingAdded[k]!;
      entries.push({
        status: "modified",
        oldBlock,
        newBlock,
        inline: diffChars(blockToText(oldBlock), blockToText(newBlock)),
      });
    }
    for (let k = paired; k < pendingRemoved.length; k += 1) {
      entries.push({ status: "removed", oldBlock: pendingRemoved[k]! });
    }
    for (let k = paired; k < pendingAdded.length; k += 1) {
      entries.push({ status: "added", newBlock: pendingAdded[k]! });
    }
    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const op of ops) {
    if (op.type === "equal") {
      flushGap();
      entries.push({ status: "equal", oldBlock: op.oldItem, newBlock: op.newItem });
    } else if (op.type === "delete") {
      pendingRemoved.push(op.oldItem);
    } else {
      pendingAdded.push(op.newItem);
    }
  }
  flushGap();
  return entries;
}

/** 差異是否為「無變更」（全部 equal）。 */
export function isUnchanged(entries: BlockDiffEntry[]): boolean {
  return entries.every((entry) => entry.status === "equal");
}
