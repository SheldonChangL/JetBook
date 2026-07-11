import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TabsNodeView } from "./tabs-node-view";

/**
 * 分頁區塊節點（D-12，F-EDIT-13）。
 * - `tabs`：block 容器，content 為 `tabItem+`（至少一個分頁）。
 * - `tabItem`：非 block-group 的結構子節點，`attrs.label` 為分頁標題（純文字），content 為 `block+`。
 * - 標題文字（label）與內文皆須進 content_md/content_text（序列化見 `lib/content/serialize.ts`）。
 * - 編輯互動（切換 / 新增 / 刪除 / 改標題）由 `TabsNodeView` 提供；active 分頁為編輯端 UI 狀態，不寫入文件（避免 autosave 抖動）。
 * - 閱讀端由 `render-content.tsx` 對應 case + `ContentTabs` client 元件互動渲染。
 *
 * R1 降險：以 TipTap `Node.create` 標準 API 定義，零自研 ProseMirror plugin。
 */
export interface TabsOptions {
  HTMLAttributes: Record<string, unknown>;
}

interface TabItemAttrs {
  label?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tabs: {
      /** 插入含兩個空白分頁的分頁區塊。 */
      setTabs: () => ReturnType;
    };
  }
}

export const Tabs = Node.create<TabsOptions>({
  name: "tabs",
  group: "block",
  content: "tabItem+",
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [{ tag: "div[data-tabs]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-tabs": "",
        class: "jb-tabs",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TabsNodeView);
  },

  addCommands() {
    return {
      setTabs:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [
              {
                type: "tabItem",
                attrs: { label: "" },
                content: [{ type: "paragraph" }],
              },
              {
                type: "tabItem",
                attrs: { label: "" },
                content: [{ type: "paragraph" }],
              },
            ],
          }),
    };
  },
});

export const TabItem = Node.create({
  name: "tabItem",
  content: "block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") ?? "",
        renderHTML: (attributes) => ({
          "data-label": (attributes as TabItemAttrs).label ?? "",
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-tab-item]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-tab-item": "",
        class: "jb-tab-panel",
      }),
      0,
    ];
  },
});
