import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { DetailsNodeView } from "./details-node-view";

/**
 * 摺疊區塊節點（D-12，F-EDIT-13）。
 * - `details`：block 容器，`attrs.summary` 為摘要標題（純文字），`attrs.open` 為預設展開狀態（預設 true）。
 * - content 為 `block+`；摘要文字與內文皆須進 content_md/content_text（序列化見 `lib/content/serialize.ts`）。
 * - 編輯端 `DetailsNodeView` 提供標題輸入與展開/收合切換（open 為作者設定的預設，會寫入文件）。
 * - 閱讀端由 `render-content.tsx` 以原生 `<details>` 渲染，瀏覽器原生互動（無需額外 client JS）。
 *
 * R1 降險：以 TipTap `Node.create` 標準 API 定義，零自研 ProseMirror plugin。
 */
export interface DetailsOptions {
  HTMLAttributes: Record<string, unknown>;
}

interface DetailsAttrs {
  summary?: string;
  open?: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    details: {
      /** 插入預設展開的摺疊區塊（含一個空段落）。 */
      setDetails: () => ReturnType;
    };
  }
}

export const Details = Node.create<DetailsOptions>({
  name: "details",
  group: "block",
  content: "block+",
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      summary: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-summary") ?? "",
        renderHTML: (attributes) => ({
          "data-summary": (attributes as DetailsAttrs).summary ?? "",
        }),
      },
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-open") !== "false",
        renderHTML: (attributes) => ({
          "data-open": (attributes as DetailsAttrs).open === false ? "false" : "true",
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-details]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-details": "",
        class: "jb-details",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DetailsNodeView);
  },

  addCommands() {
    return {
      setDetails:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { summary: "", open: true },
            content: [{ type: "paragraph" }],
          }),
    };
  },
});
