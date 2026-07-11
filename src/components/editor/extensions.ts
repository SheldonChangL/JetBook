import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import type { Extensions } from "@tiptap/react";
import { SlashCommand } from "./slash-menu/slash-command";
import { createImageExtension } from "./image/image-extension";
import { createAttachmentExtension } from "./attachment/attachment-extension";

/**
 * 編輯器 extension 組（D-01）。以 StarterKit 提供段落/標題/清單/引用/程式碼/
 * 粗斜刪除線/行內碼/hr 與 Markdown input rules。
 * D-03 加入：任務清單（TaskList/TaskItem，巢狀）與 slash 指令選單。
 * D-07 加入：圖片區塊（drop/貼上上傳 + 可編輯圖說）。
 * D-08 加入：附件區塊（slash「檔案」→ 上傳 → 卡片，編輯與閱讀一致）。
 * 其餘進階區塊（表格、callout、mention…）於 D-04~D-14 各自加入。
 *
 * R1 降險：一律採用現成 TipTap extension，不自研核心編輯行為。
 */
export function buildExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] }, // 統一 H1–H3（C11）
      codeBlock: {},
    }),
    TaskList,
    TaskItem.configure({ nested: true }), // F-EDIT-04：任務清單支援巢狀縮排
    createImageExtension(), // D-07：圖片區塊與上傳整合
    createAttachmentExtension(), // D-08：附件卡片區塊
    SlashCommand,
  ];
}
