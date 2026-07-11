"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { ArrowLeft } from "lucide-react";
import { renamePage, savePage } from "@/actions/page";
import { heartbeatLockAction, releaseLockAction } from "@/actions/lock";
import { buildExtensions } from "./extensions";
import { TableMenu } from "./table-menu";
import { startImageUpload } from "./image/image-upload";
import {
  isRetryableUploadError,
  uploadErrorMessageKey,
  type UploadErrorCode,
} from "./image/image-upload-utils";
import type { ProseMirrorDoc } from "@/lib/content/types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

const AUTOSAVE_DEBOUNCE_MS = 2000;
const HEARTBEAT_MS = 30_000;

type SaveState = "idle" | "saving" | "saved" | "conflict" | "error";

export interface PageEditorProps {
  pageId: string;
  spaceId: string;
  spaceSlug: string;
  pageSlug: string;
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
  spaceId,
  spaceSlug,
  pageSlug,
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

  // 圖片上傳（D-07）：retry 走 ref 打破 callback 循環相依
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;
  const retryRef = useRef<(file: File) => void>(() => {});

  const showUploadError = useCallback(
    (file: File, code: UploadErrorCode) => {
      toast({
        variant: "error",
        title: t(`image.${uploadErrorMessageKey(code)}`),
        action: isRetryableUploadError(code) ? (
          <button
            type="button"
            onClick={() => retryRef.current(file)}
            className="text-body-ui font-medium text-primary hover:underline"
          >
            {t("image.retry")}
          </button>
        ) : undefined,
      });
    },
    [toast, t],
  );

  const uploadImageAtSelection = useCallback(
    (file: File) => {
      const ed = editorRef.current;
      if (!ed) return;
      startImageUpload({
        editor: ed,
        file,
        pos: ed.state.selection.from,
        spaceId,
        pageId,
        uploadingLabel: t("image.uploading"),
        onError: showUploadError,
      });
    },
    [spaceId, pageId, t, showUploadError],
  );

  useEffect(() => {
    retryRef.current = uploadImageAtSelection;
  }, [uploadImageAtSelection]);

  // 把上傳設定填入 image extension 的 storage，供 drop/貼上 plugin 於事件當下讀取
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage.image;
    storage.spaceId = spaceId;
    storage.pageId = pageId;
    storage.uploadingLabel = t("image.uploading");
    storage.onError = showUploadError;
  }, [editor, spaceId, pageId, t, showUploadError]);

  const doSave = useCallback(async () => {
    if (!editor) return;
    setSaveState("saving");
    try {
      // JSON 正規化：ProseMirror 的 node.attrs 是 null-prototype 物件
      // （prosemirror-model Object.create(null)），React 序列化 Server Action
      // 參數時會視為 temporary client reference，伺服器端一存取即拋錯。
      // round-trip 轉為 plain object 後再送出（heading/taskItem/codeBlock 等
      // 帶 attrs 的節點都需要）。
      const doc = JSON.parse(JSON.stringify(editor.getJSON())) as ProseMirrorDoc;
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
          onClick={() => router.push(`/s/${spaceSlug}/${pageSlug}`)}
          className="flex items-center gap-1 text-body-ui text-fg-secondary hover:text-fg"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </button>
        <div className="flex items-center gap-3">
          <span className="text-caption text-fg-tertiary" aria-live="polite">
            {statusText}
          </span>
          <Button variant="secondary" size="sm" onClick={() => router.push(`/s/${spaceSlug}/${pageSlug}`)}>
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
      <TableMenu editor={editor} />
    </div>
  );
}
