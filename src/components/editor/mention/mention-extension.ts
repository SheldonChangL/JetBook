import Mention from "@tiptap/extension-mention";
import type { Node as TiptapNode } from "@tiptap/core";
import { searchMentionMembers, searchPageLinkTargets } from "@/actions/mentions";
import { createMentionSuggestion } from "./mention-suggestion";
import type { MentionItem } from "./mention-list";

/**
 * D-11 頁面連結與 @mention。以官方 @tiptap/extension-mention（MIT）建立兩個獨立
 * trigger 的 inline atom 節點（R1 降險：現成 extension，零自研 ProseMirror plugin）：
 *
 *  - `mention`（char `@`）：成員提及。attrs.id＝user id、label＝姓名快照；存檔後由
 *    savePage 薄殼 diff 出新增者發通知（K-02）。渲染 `@姓名` chip。
 *  - `pageLink`（char `[[`）：內部頁面連結。attrs.id＝page id（canonical 錨，改名不失效）、
 *    label＝標題快照；閱讀端以 id 查現行 slug/title（F-EDIT-12）。渲染為連結。
 *
 * 兩者的候選查詢都經 server action（薄殼 → lib，SQL 層權限過濾），不在 client 直查。
 */

const emptyOnError = <T,>(): T[] => [];

/** 成員 @mention 節點（trigger `@`）。 */
export function createMemberMention(spaceId: string): TiptapNode {
  return Mention.configure({
    HTMLAttributes: { class: "jb-mention" },
    suggestion: createMentionSuggestion({
      char: "@",
      nodeName: "mention",
      kind: "member",
      fetchItems: async (query) => {
        try {
          const rows = await searchMentionMembers({ spaceId, query });
          return rows.map<MentionItem>((u) => ({ id: u.id, label: u.name, secondary: u.email }));
        } catch {
          return emptyOnError<MentionItem>();
        }
      },
    }),
  });
}

/** 頁面連結節點（trigger `[[`），沿用 Mention 機制但以 pageId 為錨、渲染不帶 trigger 字元。 */
const PageLink = Mention.extend({ name: "pageLink" });

export function createPageLink(spaceId: string): TiptapNode {
  return PageLink.configure({
    HTMLAttributes: { class: "jb-page-link" },
    // 覆寫渲染：頁面連結顯示「標題」而非「[[標題」（不帶 trigger 字元）。
    renderText: ({ node }) =>
      (node.attrs.label as string | null) ?? (node.attrs.id as string | null) ?? "",
    renderHTML: ({ options, node }) => [
      "span",
      options.HTMLAttributes,
      (node.attrs.label as string | null) ?? (node.attrs.id as string | null) ?? "",
    ],
    suggestion: createMentionSuggestion({
      char: "[[",
      nodeName: "pageLink",
      kind: "page",
      fetchItems: async (query) => {
        try {
          const rows = await searchPageLinkTargets({ spaceId, query });
          return rows.map<MentionItem>((p) => ({ id: p.id, label: p.title, secondary: p.slug }));
        } catch {
          return emptyOnError<MentionItem>();
        }
      },
    }),
  });
}
