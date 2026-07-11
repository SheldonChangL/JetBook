import { unzipSync, strFromU8 } from "fflate";
import { ALLOWED_FILE_TYPES, fileExtension } from "@/lib/storage/validate";
import { titleFromFileName } from "./import-markdown";

/**
 * Zip 批次匯入的**純解析層**（J-02，F-IE-01）：解壓、安全防護、資料夾→頁面樹規劃、
 * 圖片引用路徑解析。無 DB／FS／server-only 相依——可單元測試。實際建頁與圖片上傳
 * 由 `src/lib/jobs/import-zip.ts` 的 worker handler 走既有儲存管線完成，本層不旁路。
 */

// ── Zip bomb / 路徑穿越安全上限（驗收：惡意 zip 被拒且有明確錯誤） ──
/** entry 數上限。 */
export const MAX_ENTRIES = 500;
/** 單一檔案解壓後大小上限（bytes）。 */
export const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024;
/** 全部檔案解壓後總量上限（bytes）。 */
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

/** 匯入支援的圖片副檔名（與 storage 白名單交集；不含 SVG——XSS 面）。 */
export const IMPORT_IMAGE_EXTENSIONS: readonly string[] = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
/** 匯入支援的 Markdown 副檔名。 */
export const IMPORT_MARKDOWN_EXTENSIONS: readonly string[] = [".md", ".markdown"];

/** 頁面/資料夾標題長度上限（對齊 pages.title 與 createPage 的 max(200)）。 */
export const IMPORT_TITLE_MAX = 200;

/** Zip 安全上限（可注入以利測試；production 一律用預設值）。 */
export interface ZipLimits {
  maxEntries: number;
  maxSingleFileBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: MAX_ENTRIES,
  maxSingleFileBytes: MAX_SINGLE_FILE_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
};

export type ZipImportErrorCode =
  | "INVALID_ZIP"
  | "EMPTY_ARCHIVE"
  | "TOO_MANY_ENTRIES"
  | "FILE_TOO_LARGE"
  | "TOTAL_TOO_LARGE"
  | "PATH_TRAVERSAL";

/** Zip 匯入解析失敗；code 供 UI 對映明確錯誤訊息（i18n）。 */
export class ZipImportError extends Error {
  constructor(
    public readonly code: ZipImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ZipImportError";
  }
}

/** 解壓後的單一檔案（路徑已正規化為根相對、正斜線）。 */
export interface ParsedZipFile {
  /** 正規化的 zip 內相對路徑（forward-slash，無前導斜線、無 `..`） */
  path: string;
  bytes: Uint8Array;
}

/**
 * 正規化 zip entry 路徑並執行路徑穿越檢查。
 * - 反斜線→正斜線；折疊空段與 `.`；前導 `/`（絕對）折為根相對。
 * - 任一 `..` 段、NUL 位元組、磁碟機代號（`C:`）一律拒絕（PATH_TRAVERSAL）。
 */
export function normalizeEntryPath(rawName: string): string {
  const unified = rawName.replace(/\\/g, "/");
  if (unified.includes("\0")) {
    throw new ZipImportError("PATH_TRAVERSAL", `非法路徑（NUL）：${rawName}`);
  }
  const out: string[] = [];
  for (const seg of unified.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      throw new ZipImportError("PATH_TRAVERSAL", `路徑穿越（..）：${rawName}`);
    }
    if (/^[a-zA-Z]:$/.test(seg)) {
      throw new ZipImportError("PATH_TRAVERSAL", `絕對路徑（磁碟機代號）：${rawName}`);
    }
    out.push(seg);
  }
  return out.join("/");
}

/** macOS 壓縮附帶的雜訊 entry（不匯入）。 */
function isMacCruft(normalizedPath: string): boolean {
  return (
    normalizedPath === "__MACOSX" ||
    normalizedPath.startsWith("__MACOSX/") ||
    normalizedPath.split("/").pop() === ".DS_Store"
  );
}

/**
 * 解壓 zip 並施加安全上限（entry 數／單檔／總量／路徑穿越）。
 *
 * 防護分兩層：
 * 1. fflate filter 在**解壓前**依 central directory 宣告的 originalSize 擋掉常見 zip bomb
 *    （宣告值誠實時，記憶體不會被撐爆）。
 * 2. 解壓後再驗實際位元組長度（防 header 尺寸造假；此時記憶體雖已配置，但仍阻止落地）。
 *
 * 目錄 entry 與 macOS 雜訊略過；路徑穿越檢查對**所有** entry（含被略過者）先行執行。
 */
export function parseImportZip(zip: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ParsedZipFile[] {
  let entryCount = 0;
  let declaredTotal = 0;

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(zip, {
      filter: (file) => {
        // 安全檢查（含被略過的 entry）：路徑穿越優先。
        const normalized = normalizeEntryPath(file.name);
        const isDir = file.name.replace(/\\/g, "/").endsWith("/");
        if (isDir || normalized === "" || isMacCruft(normalized)) return false;

        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          throw new ZipImportError("TOO_MANY_ENTRIES", `entry 數超過上限（${limits.maxEntries}）`);
        }
        if (file.originalSize > limits.maxSingleFileBytes) {
          throw new ZipImportError(
            "FILE_TOO_LARGE",
            `單檔超過上限（${limits.maxSingleFileBytes} bytes）：${file.name}`,
          );
        }
        declaredTotal += file.originalSize;
        if (declaredTotal > limits.maxTotalBytes) {
          throw new ZipImportError("TOTAL_TOO_LARGE", `解壓總量超過上限（${limits.maxTotalBytes} bytes）`);
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ZipImportError) throw error;
    throw new ZipImportError("INVALID_ZIP", "無法解析 zip 檔（格式錯誤或損毀）");
  }

  const files: ParsedZipFile[] = [];
  let actualTotal = 0;
  for (const [rawName, bytes] of Object.entries(unzipped)) {
    // 解壓後實際尺寸複驗（防宣告值造假）。
    if (bytes.byteLength > limits.maxSingleFileBytes) {
      throw new ZipImportError("FILE_TOO_LARGE", `單檔超過上限（${limits.maxSingleFileBytes} bytes）：${rawName}`);
    }
    actualTotal += bytes.byteLength;
    if (actualTotal > limits.maxTotalBytes) {
      throw new ZipImportError("TOTAL_TOO_LARGE", `解壓總量超過上限（${limits.maxTotalBytes} bytes）`);
    }
    files.push({ path: normalizeEntryPath(rawName), bytes });
  }

  if (files.length === 0) {
    throw new ZipImportError("EMPTY_ARCHIVE", "壓縮檔內沒有可匯入的檔案");
  }
  return files;
}

// ── 資料夾 → 頁面樹規劃 ─────────────────────────────────────────────

export interface ImportTreeNode {
  kind: "folder" | "page";
  /** 顯示標題（資料夾＝資料夾名；頁面＝檔名去副檔名的保底，實際建頁時可由 H1 覆寫） */
  title: string;
  /** 正規化路徑（資料夾＝資料夾路徑；頁面＝檔案路徑） */
  path: string;
  /** 頁面：原始檔名（末段），供標題保底 */
  fileName?: string;
  /** 頁面：Markdown 原文 */
  markdown?: string;
  children: ImportTreeNode[];
}

export interface ImportImage {
  /** 正規化路徑（供 Markdown 圖片引用比對） */
  path: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface SkippedEntry {
  path: string;
  reason: "unsupported-type";
}

export interface ImportPlan {
  /** 頂層節點（資料夾／頁面） */
  tree: ImportTreeNode[];
  /** 圖片檔（待上傳並改寫引用） */
  images: ImportImage[];
  /** 未支援類型（既非 md 也非圖片）——回報但不中止 */
  skipped: SkippedEntry[];
  /** 需建立的頁面總數（資料夾節點＋頁面節點） */
  pageCount: number;
}

function cap(title: string): string {
  return title.slice(0, IMPORT_TITLE_MAX).trim();
}

/**
 * 依解壓檔案清單規劃頁面樹：
 * - Markdown 檔 → 頁面節點；其祖先資料夾 → 父頁節點（資料夾＝父頁）。
 * - 圖片檔 → 收集待上傳（不建資料夾——只含圖片的資料夾不會變成空頁）。
 * - 其他類型 → skipped。
 * 節點依路徑字典序建立，順序穩定（建頁 position 依建立順序接於末尾）。
 */
export function buildImportPlan(files: ParsedZipFile[]): ImportPlan {
  const images: ImportImage[] = [];
  const skipped: SkippedEntry[] = [];
  const markdownFiles: ParsedZipFile[] = [];

  for (const file of files) {
    const ext = fileExtension(file.path);
    if (IMPORT_MARKDOWN_EXTENSIONS.includes(ext)) {
      markdownFiles.push(file);
    } else if (IMPORT_IMAGE_EXTENSIONS.includes(ext)) {
      images.push({ path: file.path, fileName: file.path.split("/").pop() ?? file.path, bytes: file.bytes });
    } else {
      skipped.push({ path: file.path, reason: "unsupported-type" });
    }
  }

  // 依路徑排序 → 資料夾與頁面的建立順序穩定。
  markdownFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const roots: ImportTreeNode[] = [];
  /** folderPath → node（含 ""＝根，以 roots 承載） */
  const folderByPath = new Map<string, ImportTreeNode>();
  let pageCount = 0;

  /** 確保某資料夾路徑（可含多段）之節點鏈存在，回傳其 children 陣列。 */
  function ensureFolder(dirPath: string): ImportTreeNode[] {
    if (dirPath === "") return roots;
    const cached = folderByPath.get(dirPath);
    if (cached) return cached.children;
    const segments = dirPath.split("/");
    const name = segments[segments.length - 1]!;
    const parentPath = segments.slice(0, -1).join("/");
    const siblings = ensureFolder(parentPath);
    const node: ImportTreeNode = { kind: "folder", title: cap(name) || name, path: dirPath, children: [] };
    siblings.push(node);
    folderByPath.set(dirPath, node);
    pageCount += 1;
    return node.children;
  }

  for (const file of markdownFiles) {
    const segments = file.path.split("/");
    const fileName = segments[segments.length - 1]!;
    const dirPath = segments.slice(0, -1).join("/");
    const siblings = ensureFolder(dirPath);
    siblings.push({
      kind: "page",
      title: cap(titleFromFileName(fileName)) || fileName,
      path: file.path,
      fileName,
      markdown: strFromU8(file.bytes),
      children: [],
    });
    pageCount += 1;
  }

  return { tree: roots, images, skipped, pageCount };
}

// ── Markdown 圖片引用 → zip 內圖片路徑解析 ──────────────────────────

/** 是否為外部/非檔案 URL（不解析為 zip 內圖片）。 */
function isExternalRef(ref: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref) || ref.startsWith("//");
}

/**
 * 將 Markdown 圖片 href 解析為 zip 內正規化路徑（供比對已上傳圖片）。
 * - 外部 URL（http/https/data…）→ null。
 * - 去除 query/fragment、percent-decode；相對於 md 檔所在目錄解析 `.`/`..`。
 * - 前導 `/` 視為 zip 根相對。無法解析或逃出根 → null。
 * @param baseDir md 檔所在目錄（正規化路徑，根為 ""）
 */
export function resolveImageRefPath(baseDir: string, href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || isExternalRef(trimmed)) return null;

  let ref = trimmed.replace(/[#?].*$/, "").replace(/\\/g, "/");
  try {
    ref = decodeURIComponent(ref);
  } catch {
    // 保留原字串（含無效 percent-encoding 時）
  }
  if (!ref) return null;

  const rootRelative = ref.startsWith("/");
  const baseSegments = rootRelative || baseDir === "" ? [] : baseDir.split("/");
  const out: string[] = [...baseSegments];
  for (const seg of ref.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null; // 逃出根：不匹配
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length > 0 ? out.join("/") : null;
}

/**
 * 推得圖片檔的 MIME type（依副檔名取白名單第一個對應值）。
 * 匯入來源無 OS 提供的 MIME，故由副檔名推定；非圖片副檔名回 null。
 */
export function inferImageMime(fileName: string): string | null {
  const ext = fileExtension(fileName);
  if (!IMPORT_IMAGE_EXTENSIONS.includes(ext)) return null;
  return ALLOWED_FILE_TYPES[ext]?.[0] ?? null;
}
