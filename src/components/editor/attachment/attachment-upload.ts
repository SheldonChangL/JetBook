import type { Editor } from "@tiptap/react";
import { normalizeUploadErrorCode, type UploadErrorCode } from "../image/image-upload-utils";

/** 上傳失敗攜帶錯誤碼（供呼叫端對應提示與重試策略）。 */
export class AttachmentUploadError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    public readonly status: number,
  ) {
    super(code);
    this.name = "AttachmentUploadError";
  }
}

/**
 * 上傳單一檔案到 /api/upload（帶 spaceId、pageId），成功回附件 id。
 * 上傳與下載 API（M-01／M-02）已存在；此處只做前端整合。
 */
export async function uploadAttachmentFile(
  file: File,
  spaceId: string,
  pageId: string,
): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  form.set("spaceId", spaceId);
  form.set("pageId", pageId);

  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    let bodyCode: unknown;
    try {
      const body = (await res.json()) as { error?: { code?: unknown } };
      bodyCode = body?.error?.code;
    } catch {
      bodyCode = undefined;
    }
    throw new AttachmentUploadError(normalizeUploadErrorCode(res.status, bodyCode), res.status);
  }

  const body = (await res.json()) as { data?: { id?: unknown } };
  const id = body?.data?.id;
  if (typeof id !== "string") {
    throw new AttachmentUploadError("UPLOAD_FAILED", res.status);
  }
  return id;
}

export interface StartAttachmentUploadOptions {
  editor: Editor;
  file: File;
  /** 插入位置（slash 觸發處或目前選取）。 */
  pos: number;
  spaceId: string;
  pageId: string;
  onError: (file: File, code: UploadErrorCode) => void;
}

/**
 * 啟動一次附件上傳：上傳成功後在 `pos` 插入 attachment 節點（檔名／大小取自
 * File 本身），失敗則回報錯誤碼（供提示與重試）。附件卡片不需上傳中預覽，
 * 因此不放佔位 decoration；`pos` 於插入前夾限至文件範圍，避免上傳期間文件
 * 變動導致位置越界。
 */
export function startAttachmentUpload({
  editor,
  file,
  pos,
  spaceId,
  pageId,
  onError,
}: StartAttachmentUploadOptions): void {
  const fileName = file.name;
  const sizeBytes = file.size;

  uploadAttachmentFile(file, spaceId, pageId)
    .then((attachmentId) => {
      const at = Math.min(pos, editor.state.doc.content.size);
      editor
        .chain()
        .insertContentAt(at, {
          type: "attachment",
          attrs: { attachmentId, fileName, sizeBytes },
        })
        .run();
    })
    .catch((error: unknown) => {
      const code = error instanceof AttachmentUploadError ? error.code : "UPLOAD_FAILED";
      onError(file, code);
    });
}
