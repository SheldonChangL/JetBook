/**
 * 附件區塊的純邏輯（無 DOM／tiptap／fetch 依賴，可單元測試）。
 *
 * picker 接受的副檔名與伺服端上傳白名單（`src/lib/storage/validate.ts`）
 * 同一事實來源——名單新增副檔名時 picker 自動同步，不需兩處維護。
 */

import { ALLOWED_FILE_TYPES } from "@/lib/storage/validate";

/** 由附件 id 組出同源下載路徑（閱讀／編輯共用；下載 API 於 /api/files 驗權限）。 */
export function attachmentFileUrl(id: string): string {
  return `/api/files/${id}`;
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
