import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { ReactNodeViewRenderer, type Extensions } from "@tiptap/react";
import { lowlight } from "@/lib/content/lowlight";
import { CodeBlockView } from "./code-block-view";
import { SlashCommand } from "./slash-menu/slash-command";
import { createImageExtension } from "./image/image-extension";
import { createAttachmentExtension } from "./attachment/attachment-extension";
import { Callout } from "./callout/callout-extension";
import { Tabs, TabItem } from "./tabs/tabs-extension";
import { Details } from "./details/details-extension";
import { Stepper, Step } from "./stepper/stepper-extension";
import { MarkdownPaste } from "./markdown-paste";

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
 * D-05 加入：表格區塊（Table/Row/Header/Cell，欄寬可拖曳）。
 * D-07 加入：圖片區塊（drop/貼上上傳 + 可編輯圖說）。
 * D-08 加入：附件區塊（slash「檔案」→ 上傳 → 卡片，編輯與閱讀一致）。
 * D-06 加入：callout 提示區塊（四語意 kind、左緣色條 + 淡底、kind 切換）。
 * D-10 加入：Markdown 貼上（多行含 md 特徵 → 轉區塊插入，否則預設）。
 * D-12 加入：分頁（tabs/tabItem）、摺疊（details）、步驟（stepper/step）容器區塊。
 * 其餘進階區塊（mention…）於後續 issue 各自加入。
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
    // D-05（F-EDIT-07）：表格。resizable 開啟欄寬拖曳（columnResizing plugin）。
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    createImageExtension(), // D-07：圖片區塊與上傳整合
    createAttachmentExtension(), // D-08：附件卡片區塊
    Callout, // D-06：四語意提示區塊（kind 可切換）
    // D-12：三種容器區塊（分頁 / 摺疊 / 步驟）。子節點（tabItem/step）不屬 block group，只在容器內出現。
    Tabs,
    TabItem,
    Details,
    Stepper,
    Step,
    MarkdownPaste, // D-10：Markdown 貼上轉區塊
    SlashCommand,
  ];
}
