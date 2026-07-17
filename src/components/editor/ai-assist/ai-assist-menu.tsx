"use client";

import { useEffect, useRef, useState } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ASSIST_MODES, type AssistMode } from "@/lib/ai/assist-modes";
import { useAiAssist } from "./use-ai-assist";

/**
 * 選取文字浮動工具列的「✦ AI」寫作輔助（I-08，F-AI-08）。
 *
 * 有非空選取且可編輯時，於選取上方浮出「✦ AI」下拉（更精簡／更正式／翻譯成英文／修正文法／改寫）。
 * 選定模式後於面板串流輸出結果，並提供【取代選取／插入下方／捨棄】——**永不直接覆寫原文**，
 * 是否套用一律由使用者決定。AI 未設定（enabled=false）或唯讀（失鎖）時不顯示。
 */

export interface AiAssistMenuProps {
  editor: Editor | null;
  pageId: string;
  /** AI 是否已設定（來自 RSC isLlmConfigured）；否則不掛載此功能。 */
  enabled: boolean;
}

export function AiAssistMenu({ editor, pageId, enabled }: AiAssistMenuProps) {
  const t = useTranslations("editor.ai");
  const assist = useAiAssist({ pageId, genericError: t("error") });
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // 套用時要用「選定模式當下」的選取範圍，而非事後可能已變動的選取。
  const rangeRef = useRef<{ from: number; to: number } | null>(null);
  // 面板／下拉開著時，即使選取塌陷也維持選單可見（供操作按鈕）。
  const panelOpen = assist.status !== "idle";
  const keepOpenRef = useRef(false);
  useEffect(() => {
    keepOpenRef.current = panelOpen || dropdownOpen;
  }, [panelOpen, dropdownOpen]);

  if (!editor || !enabled) return null;

  const startMode = (mode: AssistMode) => {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n").trim();
    if (!text) return;
    rangeRef.current = { from, to };
    setDropdownOpen(false);
    assist.run(mode, text);
  };

  const finish = () => {
    assist.reset();
    setDropdownOpen(false);
    rangeRef.current = null;
  };

  const replaceSelection = () => {
    const range = rangeRef.current;
    if (!range || !assist.result) return;
    editor.chain().focus().insertContentAt(range, assist.result).run();
    finish();
  };

  const insertBelow = () => {
    const range = rangeRef.current;
    if (!range || !assist.result) return;
    const to = Math.min(range.to, editor.state.doc.content.size);
    let insertPos = to;
    try {
      insertPos = editor.state.doc.resolve(to).after(1);
    } catch {
      insertPos = to;
    }
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, {
        type: "paragraph",
        content: [{ type: "text", text: assist.result }],
      })
      .setTextSelection(insertPos + 1)
      .run();
    finish();
  };

  const canApply = assist.status === "done" && assist.result.length > 0;

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="aiAssistBubbleMenu"
      shouldShow={({ editor: ed, from, to }) => {
        if (keepOpenRef.current) return true;
        if (!ed.isEditable) return false;
        return from < to;
      }}
      // 面板可能較高：置於選取下方並靠左，避免遮住選取內容。
      options={{ placement: "bottom-start", offset: 8 }}
    >
      {panelOpen ? (
        <div
          role="dialog"
          aria-label={t("panelLabel")}
          className="archive-ai-assist-panel w-80 rounded-md border border-edge bg-raised shadow-md"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-1.5 border-b border-edge px-3 py-2">
            <Sparkles className="size-3.5 shrink-0 text-ai" aria-hidden />
            <span className="text-caption font-medium text-fg-secondary">
              {assist.mode ? t(`modes.${assist.mode}`) : t("title")}
            </span>
            <span className="ml-auto text-caption text-fg-tertiary" aria-live="polite">
              {assist.status === "streaming"
                ? t("generating")
                : assist.status === "done"
                  ? t("ready")
                  : ""}
            </span>
          </div>

          <div className="max-h-56 overflow-y-auto px-3 py-2.5">
            {assist.status === "error" ? (
              <p className="text-body-ui text-danger">{assist.error}</p>
            ) : assist.result ? (
              <p className="whitespace-pre-wrap text-body-ui leading-6 text-fg">{assist.result}</p>
            ) : (
              <p className="text-body-ui text-fg-tertiary">{t("generating")}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-t border-edge px-3 py-2">
            {assist.status === "streaming" ? (
              <button
                type="button"
                onClick={() => assist.stop()}
                className="rounded-sm px-2 py-1 text-caption font-medium text-fg-secondary hover:bg-hover"
              >
                {t("stop")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!canApply}
                  onClick={replaceSelection}
                  className="rounded-sm bg-ai px-2 py-1 text-caption font-medium text-on-ai hover:opacity-90 disabled:opacity-40"
                >
                  {t("replace")}
                </button>
                <button
                  type="button"
                  disabled={!canApply}
                  onClick={insertBelow}
                  className="rounded-sm px-2 py-1 text-caption font-medium text-fg-secondary hover:bg-hover disabled:opacity-40"
                >
                  {t("insertBelow")}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={finish}
              className="ml-auto rounded-sm px-2 py-1 text-caption font-medium text-fg-tertiary hover:bg-hover"
            >
              {t("discard")}
            </button>
          </div>
        </div>
      ) : (
        <div
          className="archive-ai-assist-trigger rounded-md border border-edge bg-raised p-1 shadow-md"
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-body-ui font-medium text-ai hover:bg-ai-tint"
          >
            <Sparkles className="size-4 shrink-0" aria-hidden />
            {t("trigger")}
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          </button>
          {dropdownOpen ? (
            <div role="menu" aria-label={t("menuLabel")} className="mt-1 flex flex-col">
              {ASSIST_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="menuitem"
                  onClick={() => startMode(mode)}
                  className={cn(
                    "rounded-sm px-2 py-1.5 text-left text-body-ui text-fg hover:bg-hover",
                  )}
                >
                  {t(`modes.${mode}`)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </BubbleMenu>
  );
}
