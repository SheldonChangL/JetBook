/**
 * 上傳檔案驗證（純邏輯，無 DB/FS 依賴，可單元測試；同 policy.ts 模式）。
 *
 * 雙白名單（F-FILE 安全要求）：副檔名與 MIME type 都必須在名單內，
 * 且兩者必須互相對應（副檔名 .png 配 application/pdf 一樣拒絕）。
 * 名單外一律拒絕——預設拒絕原則。
 */

/** 副檔名（小寫、含點）→ 允許的 MIME type 清單。 */
export const ALLOWED_FILE_TYPES: Readonly<Record<string, readonly string[]>> = {
  // 圖片（不含 SVG：可內嵌 script，屬 XSS 面）
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".gif": ["image/gif"],
  ".webp": ["image/webp"],
  // PDF
  ".pdf": ["application/pdf"],
  // Office
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".ppt": ["application/vnd.ms-powerpoint"],
  ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  // 壓縮檔
  ".zip": ["application/zip", "application/x-zip-compressed"],
};

export type UploadValidationErrorCode = "FILE_EMPTY" | "FILE_TOO_LARGE" | "INVALID_FILE_TYPE";

/** 取檔名副檔名（小寫、含點）；無副檔名或隱藏檔（.gitignore）回空字串。 */
export function fileExtension(fileName: string): string {
  const base = fileName.trim();
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return "";
  return base.slice(idx).toLowerCase();
}

/** 驗證上傳檔案；通過回 null，否則回錯誤碼。 */
export function validateUpload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  maxBytes: number;
}): UploadValidationErrorCode | null {
  if (input.sizeBytes <= 0) return "FILE_EMPTY";
  if (input.sizeBytes > input.maxBytes) return "FILE_TOO_LARGE";
  const allowed = ALLOWED_FILE_TYPES[fileExtension(input.fileName)];
  if (!allowed || !allowed.includes(input.mimeType.toLowerCase())) return "INVALID_FILE_TYPE";
  return null;
}
