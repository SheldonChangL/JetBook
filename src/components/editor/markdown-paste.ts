import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { looksLikeMarkdown, markdownToBlockNodes } from "@/lib/content/markdown-to-doc";

/**
 * Markdown 貼上（D-10，F-EDIT-05）。
 *
 * 貼上「多行且具 Markdown 特徵」的純文字時，經 markdown-to-doc 轉為區塊後插入；
 * 其餘情形一律放行給預設處理（純文字、rich HTML、圖片檔、程式碼區塊內貼上）。
 *
 * 放行規則（回傳 false）：
 * - 無剪貼簿資料
 * - 游標位於程式碼區塊 → 保持原樣貼入純文字
 * - 剪貼簿含 text/html（自網頁複製的 rich 內容）→ 交由 ProseMirror 既有解析
 * - 純文字為單行，或不具 Markdown 特徵
 *
 * 純解析邏輯在 lib/content/markdown-to-doc（與 J-01 匯入共用），此處僅為薄殼觸發。
 */
export const MarkdownPaste = Extension.create({
  name: "markdownPaste",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("markdownPaste"),
        props: {
          handlePaste(view, event) {
            const clipboard = (event as ClipboardEvent).clipboardData;
            if (!clipboard) return false;

            // 程式碼區塊內：不轉換，讓預設把原始文字貼進去。
            if (view.state.selection.$from.parent.type.spec.code) return false;

            // 網頁 rich 內容（有 HTML）交給 ProseMirror 既有剪貼簿解析。
            const html = clipboard.getData("text/html");
            if (html && html.trim()) return false;

            const text = clipboard.getData("text/plain");
            if (!text || !text.includes("\n")) return false;
            if (!looksLikeMarkdown(text)) return false;

            const nodes = markdownToBlockNodes(text);
            if (nodes.length === 0) return false;

            event.preventDefault();
            editor.chain().focus().insertContent(nodes).run();
            return true;
          },
        },
      }),
    ];
  },
});
