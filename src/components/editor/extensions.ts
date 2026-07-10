import StarterKit from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/react";

/**
 * 編輯器 extension 組（D-01）。以 StarterKit 提供段落/標題/清單/引用/程式碼/
 * 粗斜刪除線/行內碼/hr 與 Markdown input rules。進階區塊（表格、callout、圖片、
 * 附件、mention…）於 D-03~D-14 各自加入。
 *
 * R1 降險：一律採用現成 TipTap extension，不自研核心編輯行為。
 */
export function buildExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] }, // 統一 H1–H3（C11）
      codeBlock: {},
    }),
  ];
}
