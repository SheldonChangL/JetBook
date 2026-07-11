import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import {
  DEFAULT_MERMAID_SOURCE,
  MERMAID_NODE_NAME,
  normalizeMermaidSource,
} from "@/lib/content/mermaid";
import { MermaidNodeView } from "./mermaid-node-view";

/**
 * Mermaid 圖表節點（D-13，F-EDIT-14）。
 * - 自訂 atom block 節點，`attrs.source` 為 mermaid 原始碼（canonical 存於文件 JSON）。
 * - 圖表非可編輯內文，故為 atom；原始碼於 NodeView 的 textarea 編輯（即時預覽）。
 * - 渲染只在 client 端進行（mermaid 依賴 DOM）；序列化（衍生 Markdown/純文字）由
 *   `lib/content/serialize.ts` 的 mermaid case 以 ```mermaid fenced 區塊處理，供 RAG/全文索引。
 *
 * R1 降險：以 TipTap `Node.create` 標準 API 定義節點與指令，零自研 ProseMirror plugin。
 */
export interface MermaidOptions {
  HTMLAttributes: Record<string, unknown>;
}

interface MermaidAttrs {
  source?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mermaid: {
      /** 於游標處插入 Mermaid 圖表區塊（帶預設範例原始碼）。 */
      setMermaid: (attrs?: MermaidAttrs) => ReturnType;
    };
  }
}

export const Mermaid = Node.create<MermaidOptions>({
  name: MERMAID_NODE_NAME,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element) => normalizeMermaidSource(element.getAttribute("data-source")),
        renderHTML: (attributes) => ({
          "data-source": normalizeMermaidSource((attributes as MermaidAttrs).source),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-mermaid]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-mermaid": "",
        class: "jb-mermaid",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView);
  },

  addCommands() {
    return {
      setMermaid:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              source: normalizeMermaidSource(attrs?.source) || DEFAULT_MERMAID_SOURCE,
            },
          }),
    };
  },
});
