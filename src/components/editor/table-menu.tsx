"use client";

import { useTranslations } from "next-intl";
import { BubbleMenu } from "@tiptap/react/menus";
import { type Editor } from "@tiptap/react";
import {
  BetweenVerticalStart,
  BetweenVerticalEnd,
  BetweenHorizontalStart,
  BetweenHorizontalEnd,
  Columns3,
  Rows3,
  PanelTop,
  Trash2,
  type LucideIcon,
} from "lucide-react";

/**
 * 表格編輯工具列（D-05，F-EDIT-07）。
 *
 * 以 BubbleMenu 於游標落在表格內時浮現，提供：增/刪列欄、表頭列 toggle、刪除整表。
 * 欄寬拖曳由 Table extension 的 columnResizing plugin（resizable: true）處理，不在此列。
 * 每個按鈕以 lucide icon + i18n title/aria-label 呈現（無硬編碼字串）。
 * 薄殼：僅呼叫 editor 內建 table 指令，無自研 ProseMirror 邏輯（R1）。
 */

interface TableAction {
  id: string;
  icon: LucideIcon;
  run: (editor: Editor) => boolean;
  /** true 時於此按鈕後插入分隔線（分組：欄 / 列 / 表頭 / 刪表）。 */
  dividerAfter?: boolean;
}

const TABLE_ACTIONS: readonly TableAction[] = [
  {
    id: "addColumnBefore",
    icon: BetweenVerticalStart,
    run: (editor) => editor.chain().focus().addColumnBefore().run(),
  },
  {
    id: "addColumnAfter",
    icon: BetweenVerticalEnd,
    run: (editor) => editor.chain().focus().addColumnAfter().run(),
  },
  {
    id: "deleteColumn",
    icon: Columns3,
    run: (editor) => editor.chain().focus().deleteColumn().run(),
    dividerAfter: true,
  },
  {
    id: "addRowBefore",
    icon: BetweenHorizontalStart,
    run: (editor) => editor.chain().focus().addRowBefore().run(),
  },
  {
    id: "addRowAfter",
    icon: BetweenHorizontalEnd,
    run: (editor) => editor.chain().focus().addRowAfter().run(),
  },
  {
    id: "deleteRow",
    icon: Rows3,
    run: (editor) => editor.chain().focus().deleteRow().run(),
    dividerAfter: true,
  },
  {
    id: "toggleHeaderRow",
    icon: PanelTop,
    run: (editor) => editor.chain().focus().toggleHeaderRow().run(),
    dividerAfter: true,
  },
  {
    id: "deleteTable",
    icon: Trash2,
    run: (editor) => editor.chain().focus().deleteTable().run(),
  },
];

export function TableMenu({ editor }: { editor: Editor | null }) {
  const t = useTranslations("editor.table");

  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableMenu"
      shouldShow={({ editor: ed }) => ed.isEditable && ed.isActive("table")}
      options={{ placement: "top", offset: 8 }}
      className="archive-table-menu flex items-center gap-0.5 rounded-md border border-edge bg-raised p-1 shadow-md"
    >
      {TABLE_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <span key={action.id} className="flex items-center">
            <button
              type="button"
              title={t(`${action.id}`)}
              aria-label={t(`${action.id}`)}
              onClick={() => action.run(editor)}
              className="flex size-7 items-center justify-center rounded-sm text-fg-secondary hover:bg-hover hover:text-fg"
            >
              <Icon className="size-4" aria-hidden />
            </button>
            {action.dividerAfter ? (
              <span className="mx-0.5 h-5 w-px bg-edge" aria-hidden />
            ) : null}
          </span>
        );
      })}
    </BubbleMenu>
  );
}
