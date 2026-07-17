"use client";

import { Blocks, Check, Image as ImageIcon, Paperclip, Sparkles, Table2 } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useTranslations } from "next-intl";

export interface EditorQuickActionsProps {
  variant: "commandbar" | "mobile";
  editor: Editor | null;
  disabled: boolean;
  aiEnabled: boolean;
  onInsertImage: () => void;
  onInsertAttachment: () => void;
  onDone: () => void;
}

/** 相同指令以桌面 command bar／手機 bottom dock 兩種 presentation 呈現。 */
export function EditorQuickActions({
  variant,
  editor,
  disabled,
  aiEnabled,
  onInsertImage,
  onInsertAttachment,
  onDone,
}: EditorQuickActionsProps) {
  const t = useTranslations("editor");
  const actions = [
    {
      id: "block",
      label: t("quickInsertBlock"),
      icon: Blocks,
      run: () => editor?.chain().focus().insertContent("/").run(),
    },
    { id: "image", label: t("quickInsertImage"), icon: ImageIcon, run: onInsertImage },
    {
      id: "attachment",
      label: t("quickInsertAttachment"),
      icon: Paperclip,
      run: onInsertAttachment,
    },
    {
      id: "table",
      label: t("quickInsertTable"),
      icon: Table2,
      run: () =>
        editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
  ] as const;

  if (variant === "mobile") {
    return (
      <div
        className="archive-editor-mobile-dock ui-archive-only"
        role="toolbar"
        aria-label={t("mobileTools")}
      >
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              disabled={disabled || !editor}
              onClick={action.run}
            >
              <Icon aria-hidden />
              <span>{action.label}</span>
            </button>
          );
        })}
        <button type="button" onClick={onDone} className="archive-editor-mobile-done">
          <Check aria-hidden />
          <span>{t("doneShort")}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="archive-editor-commandbar ui-archive-only"
      role="toolbar"
      aria-label={t("quickInsert")}
    >
      <span className="archive-editor-commandbar-label">{t("quickInsert")}</span>
      <div className="archive-editor-commandbar-actions">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              title={action.label}
              aria-label={action.label}
              disabled={disabled || !editor}
              onClick={action.run}
            >
              <Icon aria-hidden />
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>
      {aiEnabled && !disabled ? (
        <span className="archive-editor-ai-hint">
          <Sparkles aria-hidden />
          {t("quickAiHint")}
        </span>
      ) : null}
    </div>
  );
}
