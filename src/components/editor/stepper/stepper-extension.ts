import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { StepperNodeView, StepNodeView } from "./stepper-node-view";

/**
 * 步驟區塊節點（D-12，F-EDIT-13）。
 * - `stepper`：block 容器，content 為 `step+`（至少一個步驟）。
 * - `step`：非 block-group 的結構子節點，content 為 `block+`；序號由 CSS counter 自動產生（不寫入文件）。
 * - 內文皆須進 content_md/content_text（序列化見 `lib/content/serialize.ts`，以有序清單表示）。
 * - 編輯端提供新增（stepper 底部）與刪除（每個 step，至少保留一個）。
 * - 閱讀端由 `render-content.tsx` 以相同 class 靜態渲染（序號同樣走 CSS counter）。
 *
 * R1 降險：以 TipTap `Node.create` 標準 API 定義，零自研 ProseMirror plugin。
 */
export interface StepperOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    stepper: {
      /** 插入含三個空白步驟的步驟區塊。 */
      setStepper: () => ReturnType;
    };
  }
}

export const Stepper = Node.create<StepperOptions>({
  name: "stepper",
  group: "block",
  content: "step+",
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [{ tag: "div[data-stepper]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-stepper": "",
        class: "jb-stepper",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(StepperNodeView);
  },

  addCommands() {
    return {
      setStepper:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [
              { type: "step", content: [{ type: "paragraph" }] },
              { type: "step", content: [{ type: "paragraph" }] },
              { type: "step", content: [{ type: "paragraph" }] },
            ],
          }),
    };
  },
});

export const Step = Node.create({
  name: "step",
  content: "block+",
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-step]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-step": "",
        class: "jb-step",
      }),
      ["div", { class: "jb-step__body" }, 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(StepNodeView);
  },
});
