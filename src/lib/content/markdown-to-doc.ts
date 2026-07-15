import { marked, type Token, type Tokens } from "marked";
import type { ProseMirrorDoc, ProseMirrorMark, ProseMirrorNode } from "./types";

/**
 * Markdown → TipTap/ProseMirror JSON（D-10，F-EDIT-05）。
 *
 * 以 marked 的 lexer 取得 AST，再走訪 token 樹產出 canonical JSON（ADR-002）。
 * 純函式、零 UI 相依：編輯器 handlePaste（貼上多段 Markdown）與 J-01 匯入共用同一入口。
 *
 * 對應區塊：標題(H1–H3)、段落、引用、程式碼區塊、清單/巢狀清單、任務清單、
 *          表格、水平線；行內：粗/斜/刪除線/行內碼/連結、硬換行。
 * 刻意排除：圖片（本專案 image 節點僅渲染同源上傳檔，外部 markdown 圖片會在閱讀端被擋，
 *          故 `![alt](url)` 一律降級為連結以免內容遺失）；區塊級 raw HTML 以純文字保留。
 *
 * 例外：呼叫端可透過 `options.resolveImageSrc` 提供圖片解析器（J-02 Zip 匯入用）。
 *      當「單獨成段」的圖片 `![alt](path)` 之 path 能解析為同源上傳附件時，產生 block image
 *      節點（`src=/api/files/<id>`），而非降級為連結；解析回 null 時維持連結降級行為。
 *      未帶 options（如編輯器貼上）時行為完全不變。
 *
 * 產出的 JSON 皆為一般物件（非 null-prototype），可直接餵 savePage 與 Server Action。
 */

/** markdownToDoc 選項（opt-in；未帶時行為與既有一致）。 */
export interface MarkdownToDocOptions {
  /**
   * 圖片來源解析器：輸入原始 `![](href)` 的 href 與 alt，回傳同源上傳 URL（如
   * `/api/files/<id>`）時，單獨成段的圖片會產生 block image 節點；回 null 則維持
   * 「降級為連結」的預設行為。混排於文字中的行內圖片一律仍降級為連結（image 為 block 節點）。
   */
  resolveImageSrc?: (href: string, alt: string) => string | null;
}

/**
 * JetBook 內部附件 URL（`/api/files/<uuid>`）的辨識式：閱讀端 render-content.tsx 只渲染
 * 以 `/api/files/` 開頭的 image 節點 src，故此為「可內嵌顯示」的唯一 URL 形態。允許
 * 尾隨 query/fragment（下載 API 忽略之），正規化回 canonical 形態以保證往返穩定。
 */
const INTERNAL_ATTACHMENT_URL =
  /^\/api\/files\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:[?#].*)?$/;

/**
 * API 寫入路徑（apiCreatePage／apiUpdatePage）用的圖片解析器：只認 JetBook 內部附件
 * URL（`/api/files/<uuid>`）並回傳其 canonical 形態，使 `![alt](/api/files/<id>)` 產生
 * block image 節點（往返無失真、閱讀端內嵌顯示）；其餘（外部 http、相對路徑等）回 null，
 * 維持既有「降級為連結」行為（外部圖片請先經 import_attachment_from_url 轉為永久附件）。
 * 純函式：不做 DB 查詢（同步解析器），實際權限於 `/api/files/[id]` 下載時逐檔強制。
 */
export function internalAttachmentImageResolver(href: string): string | null {
  const match = INTERNAL_ATTACHMENT_URL.exec(href.trim());
  return match ? `/api/files/${match[1]!.toLowerCase()}` : null;
}

/**
 * 現行轉換的圖片解析器（模組層同步上下文）。轉換器為純同步遞迴、單執行緒，
 * 逐次轉換前設定、try/finally 清除；避免把 options 逐一穿透數層內部函式。
 */
let activeImageResolver: MarkdownToDocOptions["resolveImageSrc"] | null = null;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** 解碼常見 HTML 實體（marked 的 text token 會原樣保留 `&amp;` 等）。 */
function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/** 行內純文字：解碼實體並把 markdown 軟換行（單一 \n）折成空白，與 HTML 呈現一致。 */
function normalizeText(raw: string): string {
  return decodeEntities(raw).replace(/\r?\n/g, " ");
}

function textNode(text: string, marks: ProseMirrorMark[]): ProseMirrorNode {
  return marks.length > 0 ? { type: "text", text, marks: marks.map((m) => ({ ...m })) } : { type: "text", text };
}

function withMark(marks: ProseMirrorMark[], mark: ProseMirrorMark): ProseMirrorMark[] {
  return [...marks, mark];
}

/** 行內 token → 文字/marks 節點串。marks 由外層包裹（strong/em/del/link）累積傳入。 */
function inlineTokensToNodes(tokens: Token[] | undefined, marks: ProseMirrorMark[]): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        if (t.tokens && t.tokens.length > 0) {
          out.push(...inlineTokensToNodes(t.tokens, marks));
        } else {
          const text = normalizeText(t.text);
          if (text) out.push(textNode(text, marks));
        }
        break;
      }
      case "escape": {
        const text = (token as Tokens.Escape).text;
        if (text) out.push(textNode(text, marks));
        break;
      }
      case "strong":
        out.push(...inlineTokensToNodes((token as Tokens.Strong).tokens, withMark(marks, { type: "bold" })));
        break;
      case "em":
        out.push(...inlineTokensToNodes((token as Tokens.Em).tokens, withMark(marks, { type: "italic" })));
        break;
      case "del":
        out.push(...inlineTokensToNodes((token as Tokens.Del).tokens, withMark(marks, { type: "strike" })));
        break;
      case "codespan": {
        const text = (token as Tokens.Codespan).text; // 行內碼保留原字元，不解碼實體
        if (text) out.push(textNode(text, withMark(marks, { type: "code" })));
        break;
      }
      case "link": {
        const link = token as Tokens.Link;
        out.push(
          ...inlineTokensToNodes(link.tokens, withMark(marks, { type: "link", attrs: { href: link.href ?? "" } })),
        );
        break;
      }
      case "image": {
        // 外部圖片降級為連結（本專案僅渲染同源上傳圖片）：保留 href 不遺失內容。
        const image = token as Tokens.Image;
        const label = normalizeText(image.text || image.href || "");
        if (label) out.push(textNode(label, withMark(marks, { type: "link", attrs: { href: image.href ?? "" } })));
        break;
      }
      case "br":
        out.push({ type: "hardBreak" });
        break;
      case "html": {
        const text = normalizeText((token as Tokens.HTML).text);
        if (text) out.push(textNode(text, marks));
        break;
      }
      default: {
        const generic = token as { tokens?: Token[]; text?: string };
        if (generic.tokens && generic.tokens.length > 0) {
          out.push(...inlineTokensToNodes(generic.tokens, marks));
        } else if (typeof generic.text === "string") {
          const text = normalizeText(generic.text);
          if (text) out.push(textNode(text, marks));
        }
      }
    }
  }
  return out;
}

function clampHeadingLevel(depth: number): number {
  return Math.min(Math.max(Math.trunc(depth) || 1, 1), 3);
}

/** 段落節點（inline 為空時省略 content，保留空段落合法）。 */
function paragraph(tokens: Token[] | undefined): ProseMirrorNode {
  const content = inlineTokensToNodes(tokens, []);
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

/**
 * 單獨成段的圖片 → block image 節點（僅在有 activeImageResolver 且解析成功時）。
 * 其餘情況回 null，交由一般段落處理（image 降級為連結，維持既有行為）。
 */
function loneImageBlock(tokens: Token[] | undefined): ProseMirrorNode | null {
  if (!activeImageResolver || !tokens || tokens.length !== 1) return null;
  const only = tokens[0]!;
  if (only.type !== "image") return null;
  const image = only as Tokens.Image;
  const src = activeImageResolver(image.href ?? "", image.text ?? "");
  if (!src) return null;
  return { type: "image", attrs: { src, alt: normalizeText(image.text ?? "") } };
}

/** 儲存格內容：block+，永遠至少一個段落。 */
function cellParagraph(cell: Tokens.TableCell): ProseMirrorNode {
  return paragraph(cell.tokens);
}

/** 清單項目內容：paragraph block*，確保首個子節點為段落。 */
function listItemContent(item: Tokens.ListItem): ProseMirrorNode[] {
  const content = blockTokensToNodes(item.tokens);
  if (content[0]?.type !== "paragraph") {
    content.unshift({ type: "paragraph" });
  }
  return content;
}

function listToNode(list: Tokens.List): ProseMirrorNode {
  const items = list.items;
  if (list.ordered) {
    const node: ProseMirrorNode = {
      type: "orderedList",
      content: items.map((item) => ({ type: "listItem", content: listItemContent(item) })),
    };
    const start = typeof list.start === "number" ? list.start : Number(list.start);
    if (Number.isFinite(start) && start !== 1) node.attrs = { start };
    return node;
  }
  const allTasks = items.length > 0 && items.every((item) => item.task);
  if (allTasks) {
    return {
      type: "taskList",
      content: items.map((item) => ({
        type: "taskItem",
        attrs: { checked: Boolean(item.checked) },
        content: listItemContent(item),
      })),
    };
  }
  return {
    type: "bulletList",
    content: items.map((item) => ({ type: "listItem", content: listItemContent(item) })),
  };
}

function tableToNode(table: Tokens.Table): ProseMirrorNode {
  const headerRow: ProseMirrorNode = {
    type: "tableRow",
    content: table.header.map((cell) => ({ type: "tableHeader", content: [cellParagraph(cell)] })),
  };
  const bodyRows: ProseMirrorNode[] = table.rows.map((row) => ({
    type: "tableRow",
    content: row.map((cell) => ({ type: "tableCell", content: [cellParagraph(cell)] })),
  }));
  return { type: "table", content: [headerRow, ...bodyRows] };
}

/** 區塊 token 串 → 節點串。 */
function blockTokensToNodes(tokens: Token[] | undefined): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "space":
      case "def":
        break;
      case "heading": {
        const h = token as Tokens.Heading;
        const content = inlineTokensToNodes(h.tokens, []);
        const node: ProseMirrorNode = { type: "heading", attrs: { level: clampHeadingLevel(h.depth) } };
        if (content.length > 0) node.content = content;
        out.push(node);
        break;
      }
      case "paragraph": {
        const p = token as Tokens.Paragraph;
        out.push(loneImageBlock(p.tokens) ?? paragraph(p.tokens));
        break;
      }
      case "text": {
        // 清單項目（tight list）內文以 text token 承載行內內容 → 包成段落。
        const t = token as Tokens.Text;
        out.push(paragraph(t.tokens && t.tokens.length > 0 ? t.tokens : [{ type: "text", text: t.text } as Token]));
        break;
      }
      case "blockquote": {
        const children = blockTokensToNodes((token as Tokens.Blockquote).tokens);
        out.push({ type: "blockquote", content: children.length > 0 ? children : [{ type: "paragraph" }] });
        break;
      }
      case "code": {
        const c = token as Tokens.Code;
        const language = (c.lang ?? "").trim().split(/\s+/)[0] || null;
        const node: ProseMirrorNode = { type: "codeBlock", attrs: { language } };
        if (c.text.length > 0) node.content = [{ type: "text", text: c.text }];
        out.push(node);
        break;
      }
      case "list":
        out.push(listToNode(token as Tokens.List));
        break;
      case "table":
        out.push(tableToNode(token as Tokens.Table));
        break;
      case "hr":
        out.push({ type: "horizontalRule" });
        break;
      case "html": {
        const text = (token as Tokens.HTML).text.trim();
        if (text) out.push({ type: "paragraph", content: [{ type: "text", text }] });
        break;
      }
      default: {
        const generic = token as { tokens?: Token[] };
        if (generic.tokens && generic.tokens.length > 0) out.push(...blockTokensToNodes(generic.tokens));
      }
    }
  }
  return out;
}

/**
 * Markdown 字串 → ProseMirror doc（canonical JSON）。
 * 空輸入回傳空 doc（content: []），與 EMPTY_DOC 慣例一致。
 */
export function markdownToDoc(markdown: string, options?: MarkdownToDocOptions): ProseMirrorDoc {
  activeImageResolver = options?.resolveImageSrc ?? null;
  try {
    const tokens = marked.lexer(markdown, { gfm: true });
    return { type: "doc", content: blockTokensToNodes(tokens) };
  } finally {
    activeImageResolver = null;
  }
}

/** 純區塊節點串（供插入既有文件時使用，避免多包一層 doc）。 */
export function markdownToBlockNodes(markdown: string, options?: MarkdownToDocOptions): ProseMirrorNode[] {
  activeImageResolver = options?.resolveImageSrc ?? null;
  try {
    return blockTokensToNodes(marked.lexer(markdown, { gfm: true }));
  } finally {
    activeImageResolver = null;
  }
}

const MARKDOWN_BLOCK_SIGNALS: RegExp[] = [
  /^#{1,6}\s+\S/m, // ATX 標題
  /^(?:```|~~~)/m, // 圍籬程式碼
  /^\s*>\s+\S/m, // 引用
  /^\s*[-*+]\s+\S/m, // 無序清單／任務清單
  /^\s*\d+[.)]\s+\S/m, // 有序清單
  /^\s*\|?[ :]*-{3,}[-| :]*$/m, // 表格分隔列
  /^\s*([-*_])(?:\s*\1){2,}\s*$/m, // 水平線
];

const MARKDOWN_INLINE_SIGNALS: RegExp[] = [
  /\*\*[^*\n]+\*\*/, // 粗體
  /__[^_\n]+__/, // 粗體（底線）
  /`[^`\n]+`/, // 行內碼
  /\[[^\]\n]+\]\([^)\n]+\)/, // 連結
];

/**
 * 是否具備 Markdown 特徵（供貼上判斷）。
 * 命中任一區塊特徵，或任一行內特徵即視為 Markdown。
 * 呼叫端另行判斷「多行」條件（handlePaste 僅在多行時才轉換）。
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text) return false;
  return (
    MARKDOWN_BLOCK_SIGNALS.some((re) => re.test(text)) ||
    MARKDOWN_INLINE_SIGNALS.some((re) => re.test(text))
  );
}
