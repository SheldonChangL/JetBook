"use client";

import { Plus } from "lucide-react";
import { FloatingMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { useTranslations } from "next-intl";

/**
 * 插入入口（C，issue #243）：游標停在空行時左側浮現「+」鈕，點擊即插入「/」開啟 slash 選單，
 * 讓「插入區塊／圖片／檔案」不必先知道 slash 語法也能被發現（提升可發現性）。
 */
export function InsertMenu({ editor }: { editor: Editor | null }) {
  const t = useTranslations("editor");

  if (!editor) return null;

  return (
    <FloatingMenu
      editor={editor}
      pluginKey="insertMenu"
      // 僅在可編輯、且游標位於「空段落（空行）」時浮現，避免干擾正常輸入
      shouldShow={({ editor: ed }) => {
        if (!ed.isEditable) return false;
        const { $from, empty } = ed.state.selection;
        return empty && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0;
      }}
      options={{ placement: "left", offset: 8 }}
    >
      <button
        type="button"
        aria-label={t("insertBlock")}
        title={t("insertBlock")}
        onClick={() => editor.chain().focus().insertContent("/").run()}
        className="archive-editor-insert flex size-6 items-center justify-center rounded-md border border-edge bg-raised text-fg-secondary shadow-sm hover:bg-hover hover:text-fg"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </FloatingMenu>
  );
}
