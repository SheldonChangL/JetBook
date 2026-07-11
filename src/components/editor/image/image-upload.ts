import type { Editor } from "@tiptap/react";
import {
  imageFileUrl,
  normalizeUploadErrorCode,
  type UploadErrorCode,
} from "./image-upload-utils";
import { findImagePlaceholder, uploadPlaceholderKey } from "./upload-placeholder";

/** 上傳失敗攜帶錯誤碼（供呼叫端對應提示與重試策略）。 */
export class ImageUploadError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    public readonly status: number,
  ) {
    super(code);
    this.name = "ImageUploadError";
  }
}

/**
 * 上傳單一圖片檔到 /api/upload（帶 spaceId、pageId），成功回附件 id。
 * 上傳與下載 API（M-01／M-02）已存在；此處只做前端整合。
 */
export async function uploadImageFile(
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
    throw new ImageUploadError(normalizeUploadErrorCode(res.status, bodyCode), res.status);
  }

  const body = (await res.json()) as { data?: { id?: unknown } };
  const id = body?.data?.id;
  if (typeof id !== "string") {
    throw new ImageUploadError("UPLOAD_FAILED", res.status);
  }
  return id;
}

export interface StartImageUploadOptions {
  editor: Editor;
  file: File;
  /** 佔位／插入的文件位置。 */
  pos: number;
  spaceId: string;
  pageId: string;
  /** 上傳中提示文字（來自 i18n，由呼叫端提供）。 */
  uploadingLabel: string;
  onError: (file: File, code: UploadErrorCode) => void;
}

/**
 * 啟動一次圖片上傳：先放佔位 decoration（顯示預覽與進度），上傳成功後在
 * 佔位處插入真正的 image 節點，失敗則移除佔位並回報錯誤（供提示與重試）。
 */
export function startImageUpload({
  editor,
  file,
  pos,
  spaceId,
  pageId,
  uploadingLabel,
  onError,
}: StartImageUploadOptions): void {
  const view = editor.view;
  const id = Symbol("image-upload");
  const previewUrl = URL.createObjectURL(file);

  view.dispatch(
    view.state.tr.setMeta(uploadPlaceholderKey, {
      add: { id, pos, previewUrl, label: uploadingLabel },
    }),
  );

  uploadImageFile(file, spaceId, pageId)
    .then((fileId) => {
      const placeholderPos = findImagePlaceholder(editor.state, id);
      // 佔位已不在（使用者復原／刪除）：放棄插入
      if (placeholderPos === null) return;
      editor
        .chain()
        .insertContentAt(placeholderPos, {
          type: "image",
          attrs: { src: imageFileUrl(fileId), alt: "" },
        })
        .run();
      view.dispatch(view.state.tr.setMeta(uploadPlaceholderKey, { remove: { id } }));
    })
    .catch((error: unknown) => {
      view.dispatch(view.state.tr.setMeta(uploadPlaceholderKey, { remove: { id } }));
      const code = error instanceof ImageUploadError ? error.code : "UPLOAD_FAILED";
      onError(file, code);
    })
    .finally(() => {
      URL.revokeObjectURL(previewUrl);
    });
}
