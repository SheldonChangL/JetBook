"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { ArrowLeft } from "lucide-react";
import { renamePage, savePage, setPageIcon } from "@/actions/page";
import { heartbeatLockAction, releaseLockAction } from "@/actions/lock";
import { buildExtensions } from "./extensions";
import { TableMenu } from "./table-menu";
import { InsertMenu } from "./insert-menu";
import { AiAssistMenu } from "./ai-assist/ai-assist-menu";
import { startImageUpload } from "./image/image-upload";
import {
  IMAGE_MIME_TYPES,
  isRetryableUploadError,
  uploadErrorMessageKey,
  type UploadErrorCode,
} from "./image/image-upload-utils";
import { startAttachmentUpload } from "./attachment/attachment-upload";
import { attachmentAcceptAttr } from "./attachment/attachment-utils";
import type { ProseMirrorDoc } from "@/lib/content/types";
import { Button } from "@/components/ui/button";
import { EmojiPickerButton } from "@/components/ui/emoji-picker";
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
  /** 頁面 emoji 圖示（M4-03）；null＝未設定 */
  initialIcon: string | null;
  initialContent: ProseMirrorDoc | null;
  initialVersionNo: number;
  /** AI 是否已設定（isLlmConfigured）；決定是否掛載選取文字的 AI 寫作輔助（I-08）。 */
  aiEnabled: boolean;
  /** Embed 白名單網域（env EMBED_ALLOWED_DOMAINS，已正規化）；供嵌入區塊即時判斷 iframe/連結卡片（D-14）。 */
  embedAllowedDomains: string[];
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
  initialIcon,
  initialContent,
  initialVersionNo,
  aiEnabled,
  embedAllowedDomains,
}: PageEditorProps) {
  const t = useTranslations("editor");
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState(initialTitle);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // 編輯鎖被搶/逾時接手 → 降級唯讀（F-COLLAB-01 驗收 3）；記住新持有者姓名供提示
  const [lockLostBy, setLockLostBy] = useState<string | null>(null);
  const [lockLost, setLockLost] = useState(false);
  const lockLostRef = useRef(false);
  const versionRef = useRef(initialVersionNo);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: buildExtensions({ spaceId, placeholder: t("placeholder") }),
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

  // slash「圖片」→ 開圖片選擇器（僅圖片 MIME；比照附件「檔案」，#243 提升可發現性）
  const openImagePicker = useCallback(
    (pos: number) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = IMAGE_MIME_TYPES.join(",");
      input.addEventListener("change", () => {
        const files = input.files;
        const ed = editorRef.current;
        if (!files || files.length === 0 || !ed) return;
        for (const file of files) {
          startImageUpload({
            editor: ed,
            file,
            pos,
            spaceId,
            pageId,
            uploadingLabel: t("image.uploading"),
            onError: showUploadError,
          });
        }
      });
      input.click();
    },
    [spaceId, pageId, t, showUploadError],
  );

  // 把上傳設定填入 image extension 的 storage，供 drop/貼上 plugin 與 slash「圖片」於事件當下讀取
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage.image;
    storage.spaceId = spaceId;
    storage.pageId = pageId;
    storage.uploadingLabel = t("image.uploading");
    storage.onError = showUploadError;
    storage.openPicker = openImagePicker;
  }, [editor, spaceId, pageId, t, showUploadError, openImagePicker]);

  // 附件上傳（D-08）：錯誤提示與 image 一致（可重試者附重試鈕，走 selection 重傳）
  const attachmentRetryRef = useRef<(file: File) => void>(() => {});

  const showAttachmentError = useCallback(
    (file: File, code: UploadErrorCode) => {
      toast({
        variant: "error",
        title: t(`attachment.${uploadErrorMessageKey(code)}`),
        action: isRetryableUploadError(code) ? (
          <button
            type="button"
            onClick={() => attachmentRetryRef.current(file)}
            className="text-body-ui font-medium text-primary hover:underline"
          >
            {t("attachment.retry")}
          </button>
        ) : undefined,
      });
    },
    [toast, t],
  );

  const uploadAttachmentAtSelection = useCallback(
    (file: File) => {
      const ed = editorRef.current;
      if (!ed) return;
      startAttachmentUpload({
        editor: ed,
        file,
        pos: ed.state.selection.from,
        spaceId,
        pageId,
        onError: showAttachmentError,
      });
    },
    [spaceId, pageId, showAttachmentError],
  );

  useEffect(() => {
    attachmentRetryRef.current = uploadAttachmentAtSelection;
  }, [uploadAttachmentAtSelection]);

  // slash「檔案」→ 開檔案選擇器（隱藏 input，click 於使用者手勢中觸發原生對話框）
  // M4-04：支援一次選取多檔，逐檔獨立上傳與錯誤回報（單檔失敗不影響其他檔）
  const openAttachmentPicker = useCallback(
    (pos: number) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = attachmentAcceptAttr();
      input.addEventListener("change", () => {
        const files = input.files;
        const ed = editorRef.current;
        if (!files || files.length === 0 || !ed) return;
        for (const file of files) {
          startAttachmentUpload({
            editor: ed,
            file,
            pos,
            spaceId,
            pageId,
            onError: showAttachmentError,
          });
        }
      });
      input.click();
    },
    [spaceId, pageId, showAttachmentError],
  );

  // 把上傳設定填入 attachment extension 的 storage，供 slash 指令於觸發當下讀取
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage.attachment;
    storage.spaceId = spaceId;
    storage.pageId = pageId;
    storage.onError = showAttachmentError;
    storage.openPicker = openAttachmentPicker;
  }, [editor, spaceId, pageId, showAttachmentError, openAttachmentPicker]);

  // D-14：把 Embed 白名單填入 embed extension 的 storage，供 NodeView 於渲染當下判斷 iframe/連結卡片。
  useEffect(() => {
    if (!editor) return;
    editor.storage.embed.allowedDomains = embedAllowedDomains;
  }, [editor, embedAllowedDomains]);

  const doSave = useCallback(async () => {
    if (!editor || lockLostRef.current) return;
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

  // 編輯鎖心跳；離開時釋放。心跳失敗（被 Admin 搶鎖或逾時後遭他人接手）→ 即時降級唯讀。
  useEffect(() => {
    const id = setInterval(async () => {
      if (lockLostRef.current) return;
      let res: Awaited<ReturnType<typeof heartbeatLockAction>>;
      try {
        res = await heartbeatLockAction(pageId);
      } catch {
        // 心跳暫時失敗（網路/伺服器）不視為失鎖，等下一次心跳重試，避免誤降級
        return;
      }
      if (res.held || lockLostRef.current) return;
      lockLostRef.current = true;
      clearInterval(id);
      if (timerRef.current) clearTimeout(timerRef.current);
      editorRef.current?.setEditable(false);
      setLockLostBy(res.lockedByName);
      setLockLost(true);
      toast({ variant: "error", title: t("lockLostToast") });
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(id);
      void releaseLockAction(pageId);
    };
  }, [pageId, toast, t]);

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

      <div className="flex items-center gap-2">
        <EmojiPickerButton
          value={icon}
          disabled={lockLost}
          ariaLabel={t("iconPicker")}
          onChange={(next) => {
            const prev = icon;
            setIcon(next);
            void setPageIcon({ pageId, icon: next }).catch(() => {
              setIcon(prev);
              toast({ variant: "error", title: t("iconError") });
            });
          }}
        />
        <input
          value={title}
          readOnly={lockLost}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (lockLost) return;
            const trimmed = title.trim();
            if (trimmed && trimmed !== initialTitle) {
              void renamePage({ pageId, title: trimmed });
            }
          }}
          placeholder={t("titlePlaceholder")}
          className="w-full bg-transparent text-h1 text-fg outline-none placeholder:text-fg-tertiary"
          aria-label={t("titlePlaceholder")}
        />
      </div>

      {lockLost ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-sm border border-warning/40 bg-warning-tint px-3 py-2 text-body-ui text-warning"
        >
          <span>
            {lockLostBy ? t("lockLostByHint", { name: lockLostBy }) : t("lockLostHint")}
          </span>
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push(`/s/${spaceSlug}/${pageSlug}`)}
            >
              {t("backToReading")}
            </Button>
          </div>
        </div>
      ) : null}

      {saveState === "conflict" ? (
        <div role="alert" className="rounded-sm border border-warning/40 bg-warning-tint px-3 py-2 text-body-ui text-warning">
          {t("conflictHint")}
        </div>
      ) : null}

      <EditorContent editor={editor} />
      <InsertMenu editor={editor} />
      <TableMenu editor={editor} />
      <AiAssistMenu editor={editor} pageId={pageId} enabled={aiEnabled && !lockLost} />
    </div>
  );
}
