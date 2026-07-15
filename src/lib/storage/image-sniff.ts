/**
 * 匯入圖片的**內容嗅探與檔名正規化**（純邏輯，無 IO，可單元測試）。
 *
 * 以實際位元組（magic bytes）判斷真實格式——不信任副檔名或 Content-Type header。
 * 僅接受 JetBook 附件白名單內的點陣圖片（JPEG／PNG／GIF／WebP）；HTML、SVG（可內嵌
 * script）、其他格式一律回 null 由呼叫端拒絕。回傳的 mime／ext 與 storage/validate.ts 的
 * ALLOWED_FILE_TYPES 對應，確保後續 saveAttachment 的雙白名單驗證會通過。
 */

/** 嗅探結果：真實 MIME 與 canonical 副檔名（含點）。 */
export interface SniffedImage {
  mime: string;
  ext: string;
}

function hasPrefix(buf: Buffer, bytes: readonly number[]): boolean {
  if (buf.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buf[i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * 依 magic bytes 判斷圖片真實格式；非允許的圖片格式回 null。
 * - JPEG：FF D8 FF
 * - PNG ：89 50 4E 47 0D 0A 1A 0A
 * - GIF ：47 49 46 38（"GIF8"）
 * - WebP：RIFF....WEBP（0-3 "RIFF"，8-11 "WEBP"）
 */
export function sniffImage(buf: Buffer): SniffedImage | null {
  if (hasPrefix(buf, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: ".jpg" };
  if (hasPrefix(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", ext: ".png" };
  }
  if (hasPrefix(buf, [0x47, 0x49, 0x46, 0x38])) return { mime: "image/gif", ext: ".gif" };
  if (
    buf.length >= 12 &&
    hasPrefix(buf, [0x52, 0x49, 0x46, 0x46]) && // "RIFF"
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50 // "WEBP"
  ) {
    return { mime: "image/webp", ext: ".webp" };
  }
  return null;
}

/** 一組允許的圖片 MIME（供交叉比對 expectedContentType／回應 Content-Type）。 */
const ALLOWED_IMAGE_MIMES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/** 宣告的 Content-Type（去除 charset 等參數後）是否為允許的圖片 MIME。 */
export function isAllowedImageMime(contentType: string | undefined | null): boolean {
  if (!contentType) return false;
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  return ALLOWED_IMAGE_MIMES.has(mime);
}

/** 控制字元（0x00–0x1F、0x7F）：檔名內一律剝除，防注入與終端跳脫。 */
function isControlChar(codePoint: number): boolean {
  return codePoint <= 0x1f || codePoint === 0x7f;
}

/**
 * 正規化匯入檔名，防路徑穿越與副檔名不符：
 * - 取 basename（剝除任何目錄段與磁碟機路徑）。
 * - 去除控制字元（含 NUL）與前導點；保留空白與 Unicode（下載 API 以 RFC 5987 處理）。
 * - 剝掉原有副檔名，一律以嗅探出的 canonical 副檔名結尾（副檔名永遠對應真實內容）。
 * - stem 為空／全為點時退回 "image"；長度上限 180。
 */
export function normalizeImportFilename(rawName: string | undefined, canonicalExt: string): string {
  const base = (rawName ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  let stem = Array.from(base)
    .filter((ch) => !isControlChar(ch.codePointAt(0) ?? 0))
    .join("")
    .trim();
  const dot = stem.lastIndexOf(".");
  if (dot > 0) stem = stem.slice(0, dot); // 去原有副檔名
  stem = stem.replace(/^\.+/, "").trim().slice(0, 180);
  if (!stem) stem = "image";
  return `${stem}${canonicalExt}`;
}
