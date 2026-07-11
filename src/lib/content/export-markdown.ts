import { fileExtension } from "@/lib/storage/validate";

/**
 * Markdown 匯出的**純規劃層**（J-03，F-IE-02）：頁面樹 → zip 目錄結構規劃、
 * 檔名淨化與去重、附件（/api/files/<id>）連結收集與改寫為相對路徑、單頁 Markdown 組裝。
 *
 * 無 DB／FS／server-only 相依——可單元測試。實際讀頁、拉附件位元組、打包 zip 由
 * `src/lib/jobs/export-space.ts` 的 worker handler 完成，本層不觸及 IO。
 *
 * 與匯入（J-02）互為逆運算，確保 round-trip（F-IE-02）標題與結構保留：
 * - 葉頁（無子頁）→ `<標題>.md`，內容為 `# <標題>\n\n<content_md>`。
 * - 有子頁的頁 → 資料夾 `<標題>/`，自身內容寫入 `README.md`，子頁遞迴置於資料夾內。
 *   匯入端（buildImportPlan）以 `README.md`/`index.md` 為該資料夾頁的自身內容，
 *   使「內容＋子頁」的頁面完整往返。
 * - 站內附件／圖片 `/api/files/<id>` → 收集其位元組放入 `assets/<id>.<ext>`，
 *   md 連結改寫為相對於該 md 檔所在目錄的路徑；匯入端解析相對圖片路徑還原引用。
 */

/** 所有匯出附件集中放置的頂層目錄。 */
export const ASSET_DIR = "assets";

/** 資料夾頁（有子頁者）自身內容的檔名（匯入端 README/index 皆識別）。 */
export const FOLDER_CONTENT_FILENAME = "README.md";

/** 淨化後檔名／資料夾名長度上限（避免過長路徑）。 */
export const SEGMENT_MAX = 120;

/** 標題為空時的保底檔名。 */
const UNTITLED = "untitled";

/** 資料夾內保留給「資料夾自身內容」的檔名 base（小寫，避免子頁撞名）。 */
const RESERVED_CHILD_BASENAMES: readonly string[] = ["readme", "index"];

/** 檔名中非法字元（路徑分隔與 Windows 保留符號）；控制字元另以 codepoint 過濾。 */
const ILLEGAL_SEGMENT_CHARS = /[/\\:*?"<>|]/g;

/** 站內附件連結樣式：`/api/files/<uuid>`（content_md 中圖片與附件節點皆為此形式）。 */
const FILE_REF_RE =
  /\/api\/files\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g;

/** 匯出所需的最小頁面欄位（呼叫端由 DB 取得後投影）。 */
export interface ExportPage {
  id: string;
  parentId: string | null;
  title: string;
  contentMd: string;
}

/** 頁面樹節點（由平面列表組裝）。 */
export interface ExportNode {
  page: ExportPage;
  children: ExportNode[];
}

/** 規劃後的單一 md 檔項目。 */
export interface ExportFileEntry {
  page: ExportPage;
  /** zip 內的 md 檔路徑（forward-slash）。 */
  path: string;
  /** 該 md 檔所在目錄（根為 ""）；供計算附件相對路徑。 */
  dir: string;
  /** 是否為資料夾頁（有子頁，內容寫入 README.md）。 */
  isFolder: boolean;
}

/** 將控制字元（U+0000–U+001F）替換為空白，避免非法檔名位元組。 */
function stripControlChars(input: string): string {
  let out = "";
  for (const ch of input) {
    out += (ch.codePointAt(0) ?? 0) < 0x20 ? " " : ch;
  }
  return out;
}

/**
 * 淨化單一路徑段（檔名／資料夾名）：移除路徑分隔與控制字元、Windows 保留字元、
 * 前後點與空白，並限制長度。回傳空字串時呼叫端以 UNTITLED 保底。
 */
export function sanitizeSegment(name: string): string {
  return stripControlChars(name)
    .replace(ILLEGAL_SEGMENT_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .trim()
    .slice(0, SEGMENT_MAX)
    .trim();
}

/** 在同一命名空間（siblings）內取唯一名稱；撞名時附 `-2`、`-3`…（不分大小寫比對）。 */
function uniqueName(base: string, used: Set<string>): string {
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * 由平面頁面列表（呼叫端已依 position 排序）組裝頁面樹。
 * 同一父節點下的相對順序沿用輸入順序；parentId 指向不存在頁（如父頁已軟刪）者視為根層。
 */
export function buildExportForest(pages: ExportPage[]): ExportNode[] {
  const idSet = new Set(pages.map((p) => p.id));
  const childrenByParent = new Map<string, ExportNode[]>();
  const roots: ExportNode[] = [];

  for (const page of pages) {
    const node: ExportNode = { page, children: [] };
    const parentKey = page.parentId && idSet.has(page.parentId) ? page.parentId : null;
    if (parentKey === null) {
      roots.push(node);
    } else {
      const siblings = childrenByParent.get(parentKey);
      if (siblings) siblings.push(node);
      else childrenByParent.set(parentKey, [node]);
    }
  }

  const attach = (node: ExportNode): void => {
    node.children = childrenByParent.get(node.page.id) ?? [];
    for (const child of node.children) attach(child);
  };
  for (const root of roots) attach(root);
  return roots;
}

/**
 * 規劃頁面樹 → md 檔佈局（路徑、目錄、資料夾/葉頁），檔名淨化並於同層去重。
 * 根層保留 `assets` 名以免與附件目錄相撞；資料夾內保留 `readme`/`index` 給自身內容檔。
 */
export function layoutExport(forest: ExportNode[]): ExportFileEntry[] {
  const entries: ExportFileEntry[] = [];

  const walk = (nodes: ExportNode[], parentDir: string, reserved: readonly string[]): void => {
    const used = new Set<string>(reserved);
    for (const node of nodes) {
      const base = sanitizeSegment(node.page.title) || UNTITLED;
      const name = uniqueName(base, used);
      if (node.children.length > 0) {
        const dir = parentDir ? `${parentDir}/${name}` : name;
        entries.push({ page: node.page, path: `${dir}/${FOLDER_CONTENT_FILENAME}`, dir, isFolder: true });
        walk(node.children, dir, RESERVED_CHILD_BASENAMES);
      } else {
        const path = parentDir ? `${parentDir}/${name}.md` : `${name}.md`;
        entries.push({ page: node.page, path, dir: parentDir, isFolder: false });
      }
    }
  };

  walk(forest, "", [ASSET_DIR.toLowerCase()]);
  return entries;
}

/** 收集 markdown 內所有站內附件 id（去重、小寫）。 */
export function collectAttachmentIds(markdown: string): string[] {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(FILE_REF_RE)) {
    ids.add(match[1]!.toLowerCase());
  }
  return [...ids];
}

/**
 * 改寫 markdown 內的站內附件連結：`/api/files/<id>` → resolve(id) 回傳的相對路徑；
 * resolve 回 null（附件不存在／不屬本空間）時維持原連結不動。
 */
export function rewriteAttachmentLinks(
  markdown: string,
  resolve: (id: string) => string | null,
): string {
  return markdown.replace(FILE_REF_RE, (whole, id: string) => {
    const rel = resolve(id.toLowerCase());
    return rel ?? whole;
  });
}

/** 附件於 zip 內的路徑：`assets/<id>.<ext>`（ext 依原檔名推得，無副檔名則省略）。 */
export function assetZipPath(id: string, fileName: string): string {
  return `${ASSET_DIR}/${id}${fileExtension(fileName)}`;
}

/**
 * 由某 md 檔所在目錄（fromDir，根為 ""）計算指向 assets/ 內某資產的相對路徑。
 * 例：fromDir="A/B" → `../../assets/x.png`；fromDir="" → `assets/x.png`。
 */
export function relativeAssetPath(fromDir: string, assetPath: string): string {
  const depth = fromDir === "" ? 0 : fromDir.split("/").length;
  return `${"../".repeat(depth)}${assetPath}`;
}

/**
 * 組裝單頁匯出 Markdown：標題化為首個 H1（供匯入端還原 pages.title），其後接 content_md。
 * 標題為空時省略 H1（匯入端改以檔名保底）。
 */
export function pageFileMarkdown(title: string, contentMd: string): string {
  const heading = title.trim() ? `# ${title.trim()}` : "";
  const body = contentMd.trim() ? contentMd : "";
  const parts = [heading, body].filter(Boolean);
  return parts.length > 0 ? `${parts.join("\n\n")}\n` : "";
}
