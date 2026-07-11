import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer, type Extensions } from "@tiptap/react";
import { lowlight } from "@/lib/content/lowlight";
import { CodeBlockView } from "./code-block-view";
import { SlashCommand } from "./slash-menu/slash-command";
import { createImageExtension } from "./image/image-extension";
import { createAttachmentExtension } from "./attachment/attachment-extension";

/**
 * 程式碼區塊（D-04，F-EDIT-06）：以 CodeBlockLowlight 取代 StarterKit 內建 codeBlock，
 * 提供 ≥20 語言語法高亮；掛 React NodeView（語言搜尋下拉 + 行號）；Esc 跳出區塊。
 * 節點名稱與 toggleCodeBlock 指令維持不變，slash 選單與 Markdown 輸入規則無須更動。
 */
const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // F-EDIT-06：游標在程式碼區塊內按 Esc → 於其後插入段落並跳出。
      Escape: () => {
        const { selection } = this.editor.state;
        const { $from } = selection;
        if ($from.parent.type.name !== this.name) return false;
        const after = $from.after();
        return this.editor
          .chain()
          .insertContentAt(after, { type: "paragraph" })
          .setTextSelection(after + 1)
          .focus()
          .run();
      },
    };
  },
});

/**
 * 編輯器 extension 組（D-01）。以 StarterKit 提供段落/標題/清單/引用/
 * 粗斜刪除線/行內碼/hr 與 Markdown input rules。
 * D-03 加入：任務清單（TaskList/TaskItem，巢狀）與 slash 指令選單。
 * D-04 加入：程式碼區塊語法高亮（lowlight）+ 語言下拉 NodeView。
 * D-07 加入：圖片區塊（drop/貼上上傳 + 可編輯圖說）。
 * D-08 加入：附件區塊（slash「檔案」→ 上傳 → 卡片，編輯與閱讀一致）。
 * 其餘進階區塊（表格、callout、mention…）於後續 issue 各自加入。
 *
 * R1 降險：一律採用現成 TipTap extension，不自研核心編輯行為。
 */
export function buildExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] }, // 統一 H1–H3（C11）
      codeBlock: false, // 由 CodeBlockLowlight 取代
    }),
    CodeBlock.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }), // F-EDIT-04：任務清單支援巢狀縮排
    createImageExtension(), // D-07：圖片區塊與上傳整合
    createAttachmentExtension(), // D-08：附件卡片區塊
    SlashCommand,
  ];
}
