/**
 * 圖片上傳的純邏輯（無 DOM／tiptap／fetch 依賴，可單元測試）。
 *
 * 與伺服端上傳白名單（`src/lib/storage/validate.ts`）對齊的圖片 MIME 子集；
 * 上傳只接受這些型別的檔案（SVG 不在內，屬 XSS 面）。
 */

/** 允許上傳的圖片 MIME type（對應 validate.ts 圖片副檔名白名單）。 */
export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

/** 上傳失敗錯誤碼（對應 /api/upload 的 error.code 與 HTTP status）。 */
export type UploadErrorCode =
  | "FILE_TOO_LARGE"
  | "INVALID_FILE_TYPE"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "UPLOAD_FAILED";

/** 是否為可上傳的圖片檔（依 MIME 判斷；名單外一律拒絕）。 */
export function isImageFile(file: { type: string }): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(file.type.toLowerCase());
}

/** 由附件 id 組出同源下載路徑（閱讀／編輯共用的圖片 src）。 */
export function imageFileUrl(id: string): string {
  return `/api/files/${id}`;
}

/** 從 FileList 篩出圖片檔（drop/貼上時過濾非圖片，交還預設處理）。 */
export function getImageFiles(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((file) => isImageFile(file));
}

/**
 * 依回應 body 的 error.code 與 HTTP status 正規化為 UploadErrorCode。
 * body code 優先；無法辨識時退回 status 對應，再退回泛用 UPLOAD_FAILED。
 */
export function normalizeUploadErrorCode(status: number, bodyCode: unknown): UploadErrorCode {
  if (
    bodyCode === "FILE_TOO_LARGE" ||
    bodyCode === "INVALID_FILE_TYPE" ||
    bodyCode === "FORBIDDEN" ||
    bodyCode === "UNAUTHORIZED"
  ) {
    return bodyCode;
  }
  switch (status) {
    case 413:
      return "FILE_TOO_LARGE";
    case 415:
      return "INVALID_FILE_TYPE";
    case 403:
      return "FORBIDDEN";
    case 401:
      return "UNAUTHORIZED";
    default:
      return "UPLOAD_FAILED";
  }
}

/** 錯誤碼 → i18n 訊息 key 後綴（editor.image.<key>）。 */
export function uploadErrorMessageKey(code: UploadErrorCode): string {
  switch (code) {
    case "FILE_TOO_LARGE":
      return "errorTooLarge";
    case "INVALID_FILE_TYPE":
      return "errorType";
    case "FORBIDDEN":
    case "UNAUTHORIZED":
      return "errorForbidden";
    default:
      return "uploadError";
  }
}

/**
 * 是否值得提供「重試」：驗證類錯誤（過大／格式）與權限錯誤重試無用，
 * 只有暫時性失敗（網路／未知）才顯示重試。
 */
export function isRetryableUploadError(code: UploadErrorCode): boolean {
  return code === "UPLOAD_FAILED";
}
