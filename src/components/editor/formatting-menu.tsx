"use client";

import { Bold, Code2, Italic, Strikethrough, type LucideIcon } from "lucide-react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useEditorState, type Editor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface FormattingAction {
  id: "bold" | "italic" | "strike" | "code";
  icon: LucideIcon;
  run: (editor: Editor) => boolean;
}

const FORMATTING_ACTIONS: readonly FormattingAction[] = [
  { id: "bold", icon: Bold, run: (editor) => editor.chain().focus().toggleBold().run() },
  { id: "italic", icon: Italic, run: (editor) => editor.chain().focus().toggleItalic().run() },
  {
    id: "strike",
    icon: Strikethrough,
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  { id: "code", icon: Code2, run: (editor) => editor.chain().focus().toggleCode().run() },
];

/** 選取文字時顯示既有 StarterKit mark 指令；不新增 schema 或自研 ProseMirror 行為。 */
export function FormattingMenu({ editor }: { editor: Editor | null }) {
  const t = useTranslations("editor.formatting");
  const activeMarks = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      strike: current?.isActive("strike") ?? false,
      code: current?.isActive("code") ?? false,
    }),
  });

  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="formattingMenu"
      shouldShow={({ editor: current, from, to }) =>
        current.isEditable && from < to && !current.isActive("codeBlock")
      }
      options={{ placement: "top", offset: 8 }}
      className="archive-formatting-menu ui-archive-only flex items-center gap-0.5 border border-edge bg-raised p-1 shadow-md"
    >
      {FORMATTING_ACTIONS.map((action) => {
        const Icon = action.icon;
        const active = activeMarks?.[action.id] ?? false;
        return (
          <button
            key={action.id}
            type="button"
            title={t(action.id)}
            aria-label={t(action.id)}
            aria-pressed={active}
            onClick={() => action.run(editor)}
            className={cn(
              "flex size-7 items-center justify-center text-fg-secondary hover:bg-hover hover:text-fg",
              active && "bg-primary-tint text-primary",
            )}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </BubbleMenu>
  );
}
