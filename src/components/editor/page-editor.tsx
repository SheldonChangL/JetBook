"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor } from "@tiptap/react";
import { ArrowLeft } from "lucide-react";
import { renamePage, savePage } from "@/actions/page";
import { heartbeatLockAction, releaseLockAction } from "@/actions/lock";
import { buildExtensions } from "./extensions";
import type { ProseMirrorDoc } from "@/lib/content/types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

const AUTOSAVE_DEBOUNCE_MS = 2000;
const HEARTBEAT_MS = 30_000;

type SaveState = "idle" | "saving" | "saved" | "conflict" | "error";

export interface PageEditorProps {
  pageId: string;
  spaceSlug: string;
  initialTitle: string;
  initialContent: ProseMirrorDoc | null;
  initialVersionNo: number;
}

/**
 * 區塊編輯器（D-01）：TipTap + autosave（≥2s debounce）+ 編輯鎖心跳（30s）。
 * 儲存走 savePage（三欄同步 + 樂觀鎖 + 版本快照）。無發布按鈕（C2 直接編輯）。
 */
export function PageEditor({
  pageId,
  spaceSlug,
  initialTitle,
  initialContent,
  initialVersionNo,
}: PageEditorProps) {
  const t = useTranslations("editor");
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState(initialTitle);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const versionRef = useRef(initialVersionNo);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: buildExtensions(),
    content: initialContent ?? undefined,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose-editor min-h-[60vh] max-w-none text-body-read leading-[1.75] text-fg focus:outline-none",
      },
    },
  });

  const doSave = useCallback(async () => {
    if (!editor) return;
    setSaveState("saving");
    try {
      const doc = editor.getJSON() as ProseMirrorDoc;
      const result = await savePage({
        pageId,
        expectedVersionNo: versionRef.current,
        content: doc,
      });
      versionRef.current = result.versionNo;
      setSaveState("saved");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("VERSION_CONFLICT")) {
        setSaveState("conflict");
      } else {
        setSaveState("error");
        toast({ variant: "error", title: t("saveError") });
      }
    }
  }, [editor, pageId, t, toast]);

  // autosave：內容變更後 debounce 送出
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      setSaveState("idle");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(doSave, AUTOSAVE_DEBOUNCE_MS);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, doSave]);

  // 編輯鎖心跳；離開時釋放
  useEffect(() => {
    const id = setInterval(() => {
      void heartbeatLockAction(pageId);
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(id);
      void releaseLockAction(pageId);
    };
  }, [pageId]);

  const statusText =
    saveState === "saving"
      ? t("saving")
      : saveState === "saved"
        ? t("saved")
        : saveState === "conflict"
          ? t("conflict")
          : "";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push(`/s/${spaceSlug}`)}
          className="flex items-center gap-1 text-body-ui text-fg-secondary hover:text-fg"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </button>
        <div className="flex items-center gap-3">
          <span className="text-caption text-fg-tertiary" aria-live="polite">
            {statusText}
          </span>
          <Button variant="secondary" size="sm" onClick={() => router.push(`/s/${spaceSlug}`)}>
            {t("done")}
          </Button>
        </div>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          const trimmed = title.trim();
          if (trimmed && trimmed !== initialTitle) {
            void renamePage({ pageId, title: trimmed });
          }
        }}
        placeholder={t("titlePlaceholder")}
        className="w-full bg-transparent text-h1 text-fg outline-none placeholder:text-fg-tertiary"
        aria-label={t("titlePlaceholder")}
      />

      {saveState === "conflict" ? (
        <div role="alert" className="rounded-sm border border-warning/40 bg-warning-tint px-3 py-2 text-body-ui text-warning">
          {t("conflictHint")}
        </div>
      ) : null}

      <EditorContent editor={editor} />
    </div>
  );
}
