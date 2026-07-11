import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import {
  DEFAULT_CALLOUT_KIND,
  normalizeCalloutKind,
  type CalloutKind,
} from "@/lib/content/callout";
import { CalloutNodeView } from "./callout-node-view";

/**
 * Callout 提示區塊節點（D-06，F-EDIT-08）。
 * - 自訂 block 節點，`attrs.kind` ∈ info|success|warning|danger（預設拒絕，非法回落 info）。
 * - content 為 `block+`（如 blockquote 可含段落/清單等），kind 切換只改屬性，內容不動 → 切換不失內容。
 * - NodeView 提供左緣 3px 語意色條 + 淡底（token）與右上角 kind 切換工具列。
 * - 序列化（衍生 Markdown/純文字）由 `lib/content/serialize.ts` 的 callout case 處理。
 *
 * R1 降險：以 TipTap `Node.create` 標準 API 定義節點與指令，零自研 ProseMirror plugin。
 */
export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

interface CalloutAttrs {
  kind?: CalloutKind;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** 將目前選取的區塊包成 callout（指定 kind）。 */
      setCallout: (attrs?: CalloutAttrs) => ReturnType;
      /** 切換 callout 包裹（已是 callout 則解除）。 */
      toggleCallout: (attrs?: CalloutAttrs) => ReturnType;
      /** 解除 callout 包裹，內容升回上層。 */
      unsetCallout: () => ReturnType;
      /** 就地更新 kind（不動內容）。 */
      updateCalloutKind: (kind: CalloutKind) => ReturnType;
    };
  }
}

export const Callout = Node.create<CalloutOptions>({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      kind: {
        default: DEFAULT_CALLOUT_KIND,
        parseHTML: (element) => normalizeCalloutKind(element.getAttribute("data-kind")),
        renderHTML: (attributes) => ({
          "data-kind": normalizeCalloutKind((attributes as CalloutAttrs).kind),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-callout": "",
        class: "jb-callout",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView);
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind: normalizeCalloutKind(attrs?.kind) }),
      toggleCallout:
        (attrs) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { kind: normalizeCalloutKind(attrs?.kind) }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
      updateCalloutKind:
        (kind) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { kind: normalizeCalloutKind(kind) }),
    };
  },
});
