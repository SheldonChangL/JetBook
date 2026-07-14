/**
 * 附件區塊的純邏輯（無 DOM／tiptap／fetch 依賴，可單元測試）。
 *
 * picker 接受的副檔名與伺服端上傳白名單（`src/lib/storage/validate.ts`）
 * 同一事實來源——名單新增副檔名時 picker 自動同步，不需兩處維護。
 */

import {
  ALLOWED_FILE_TYPES,
  OFFICE_PREVIEW_EXTENSIONS,
  fileExtension,
} from "@/lib/storage/validate";

/** 由附件 id 組出同源下載路徑（閱讀／編輯共用；下載 API 於 /api/files 驗權限）。 */
export function attachmentFileUrl(id: string): string {
  return `/api/files/${id}`;
}

/** 線上預覽路徑（M4-11）：伺服端僅對 PDF 回 inline，其餘 404。 */
export function attachmentPreviewUrl(id: string): string {
  return `/api/files/${id}/preview`;
}

/** 是否為原生可線上預覽的附件（M4-11：PDF，無需轉檔）。 */
export function isPreviewableAttachment(fileName: string): boolean {
  return fileExtension(fileName) === ".pdf";
}

/** 是否為可經轉檔預覽的 Office 附件（M4-12；還需部署啟用轉檔服務）。 */
export function isOfficePreviewCandidate(fileName: string): boolean {
  return OFFICE_PREVIEW_EXTENSIONS.has(fileExtension(fileName));
}

/**
 * file input 的 accept 值：白名單所有副檔名（逗號分隔）。
 * 上限與型別最終仍由 /api/upload 伺服端強制（picker accept 僅為 UX 過濾）。
 */
export function attachmentAcceptAttr(): string {
  return Object.keys(ALLOWED_FILE_TYPES).join(",");
}

/**
 * bytes → 人類可讀大小（B／KB／MB／GB／TB，至多一位小數）。
 * 非有限值或負數回空字串（不顯示無意義大小）。
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}
