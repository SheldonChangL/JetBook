import type { ProseMirrorDoc, ProseMirrorNode } from "./types";

/**
 * 從 TipTap JSON 蒐集 @mention 與頁面連結（D-11）。
 *
 * canonical 是 JSON；此處只做「單向」讀取（存檔時 diff 新增 mention 以發通知、
 * 閱讀時預先解析頁面連結目標）。純函式、無 DB 依賴，可於 client／server／測試共用。
 *
 * - `mention` 節點 attrs.id＝被提及使用者的 user id。
 * - `pageLink` 節點 attrs.id＝連結目標頁面的 page id（改名不失效：以 id 為錨，
 *   render 時再查現行 slug/title）。
 */

function walk(node: ProseMirrorNode, visit: (n: ProseMirrorNode) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

function collectAttrIds(doc: ProseMirrorDoc | null | undefined, nodeType: string): Set<string> {
  const ids = new Set<string>();
  if (!doc?.content) return ids;
  for (const child of doc.content) {
    walk(child, (n) => {
      if (n.type !== nodeType) return;
      const id = n.attrs?.id;
      if (typeof id === "string" && id.length > 0) ids.add(id);
    });
  }
  return ids;
}

/** 蒐集文件內所有 @mention 的 user id（去重）。 */
export function collectMentionUserIds(doc: ProseMirrorDoc | null | undefined): Set<string> {
  return collectAttrIds(doc, "mention");
}

/** 蒐集文件內所有頁面連結的目標 page id（去重）。 */
export function collectPageLinkIds(doc: ProseMirrorDoc | null | undefined): Set<string> {
  return collectAttrIds(doc, "pageLink");
}

/**
 * 相對於舊內容，找出「本次新增」的 mention user id（存檔通知用）。
 * 已存在於舊版的 mention 不重複通知，避免高頻 autosave 洗版。
 */
export function newlyMentionedUserIds(
  previous: ProseMirrorDoc | null | undefined,
  next: ProseMirrorDoc | null | undefined,
): string[] {
  const before = collectMentionUserIds(previous);
  const after = collectMentionUserIds(next);
  return [...after].filter((id) => !before.has(id));
}
