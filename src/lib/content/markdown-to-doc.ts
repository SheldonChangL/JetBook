import type { ProseMirrorDoc, ProseMirrorMark, ProseMirrorNode } from "./types";

/**
 * Markdown → TipTap/ProseMirror JSON（canonical）轉換器（J-01 / F-IE-01）。
 *
 * 產出節點對齊 `buildExtensions()`（StarterKit + TaskList/Table/Image/CodeBlock）：
 * 段落、heading(1–3)、bulletList/orderedList、taskList、codeBlock、blockquote、
 * table、image、horizontalRule；行內：bold/italic/strike/code/link。
 *
 * 依賴約束：不引入 markdown 解析套件（避免新增相依，R1 降險），以字典序 line-based
 * 掃描解析常見 Markdown 子集。此為 docToMarkdown()（serialize.ts）的近似逆向，
 * 供 Markdown 匯入與貼上重用。
 */

const HR_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const ATX_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const BLOCKQUOTE_RE = /^ {0,3}>\s?(.*)$/;
const UL_RE = /^(\s*)([-*+])\s+(.*)$/;
const OL_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const TASK_RE = /^\[([ xX])\]\s+(.*)$/;
const IMAGE_ONLY_RE = /^ {0,3}!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/;
const TABLE_SEP_RE = /^\s*\|?(?:\s*:?-{1,}:?\s*\|)+(?:\s*:?-{1,}:?\s*)?\|?\s*$/;

function clampHeadingLevel(level: number): number {
  // 編輯器僅支援 H1–H3（extensions.ts heading.levels）；更深標題降級為 H3。
  return Math.min(Math.max(level, 1), 3);
}

/** 拆出一列表格的 cell（去除首尾 pipe，處理跳脫的 \| ）。 */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|\s*$/, "");
  const cells: string[] = [];
  let buf = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      buf += "|";
      i++;
    } else if (ch === "|") {
      cells.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  cells.push(buf.trim());
  return cells;
}

/** 段落內文字包成 paragraph 節點（空內容 → 空 paragraph）。 */
function paragraph(text: string): ProseMirrorNode {
  const inline = parseInline(text);
  return inline.length > 0
    ? { type: "paragraph", content: inline }
    : { type: "paragraph" };
}

// --- 行內解析（marks） -------------------------------------------------------

interface InlineToken {
  re: RegExp;
  build: (m: RegExpExecArray) => ProseMirrorNode[];
}

function withMark(nodes: ProseMirrorNode[], mark: ProseMirrorMark): ProseMirrorNode[] {
  return nodes.map((n) =>
    n.type === "text"
      ? { ...n, marks: [...(n.marks ?? []), mark] }
      : n,
  );
}

function textNode(text: string): ProseMirrorNode {
  return { type: "text", text };
}

/**
 * 行內語法解析：找出最早出現的行內標記，遞迴處理其內容與其後文字。
 * 優先序以「最左出現位置」決定；inline code 內部不再解析其他標記。
 */
function parseInline(input: string): ProseMirrorNode[] {
  if (input === "") return [];
  const tokens: InlineToken[] = [
    // inline code：反引號內原文，不再套用其他標記
    {
      re: /`([^`]+)`/,
      build: (m) => [{ ...textNode(m[1]!), marks: [{ type: "code" }] }],
    },
    // image（行內）：TipTap image 為 block node，行內圖片以 alt 文字保底呈現
    {
      re: /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/,
      build: (m) => (m[1] ? [textNode(m[1]!)] : []),
    },
    // link
    {
      re: /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/,
      build: (m) =>
        withMark(parseInline(m[1]!), {
          type: "link",
          attrs: { href: m[2]!, ...(m[3] ? { title: m[3] } : {}) },
        }),
    },
    // bold（** 或 __）
    {
      re: /\*\*([^*]+)\*\*|__([^_]+)__/,
      build: (m) => withMark(parseInline(m[1] ?? m[2]!), { type: "bold" }),
    },
    // strike
    {
      re: /~~([^~]+)~~/,
      build: (m) => withMark(parseInline(m[1]!), { type: "strike" }),
    },
    // italic（* 或 _）
    {
      re: /\*([^*]+)\*|_([^_]+)_/,
      build: (m) => withMark(parseInline(m[1] ?? m[2]!), { type: "italic" }),
    },
  ];

  let earliest: { index: number; length: number; nodes: ProseMirrorNode[] } | null = null;
  for (const tok of tokens) {
    const m = tok.re.exec(input);
    if (m && (earliest === null || m.index < earliest.index)) {
      earliest = { index: m.index, length: m[0].length, nodes: tok.build(m) };
    }
  }

  if (!earliest) return [textNode(input)];

  const before = input.slice(0, earliest.index);
  const after = input.slice(earliest.index + earliest.length);
  const out: ProseMirrorNode[] = [];
  if (before) out.push(textNode(before));
  out.push(...earliest.nodes);
  if (after) out.push(...parseInline(after));
  return out;
}

// --- 區塊解析 ----------------------------------------------------------------

interface ListItemLine {
  indent: number;
  marker: "ul" | "ol";
  text: string;
  task: boolean;
  checked: boolean;
}

function matchListItem(line: string): ListItemLine | null {
  const ul = UL_RE.exec(line);
  if (ul) {
    const rest = ul[3]!;
    const task = TASK_RE.exec(rest);
    return {
      indent: ul[1]!.length,
      marker: "ul",
      text: task ? task[2]! : rest,
      task: Boolean(task),
      checked: task ? task[1]!.toLowerCase() === "x" : false,
    };
  }
  const ol = OL_RE.exec(line);
  if (ol) {
    return { indent: ol[1]!.length, marker: "ol", text: ol[3]!, task: false, checked: false };
  }
  return null;
}

/** 從 lines[start] 起連續同層級的清單解析為 list 節點；回傳節點與下一行索引。 */
function parseList(lines: string[], start: number): { node: ProseMirrorNode; next: number } {
  const first = matchListItem(lines[start]!)!;
  const baseIndent = first.indent;
  const isTask = first.task;
  const isOrdered = first.marker === "ol";
  const items: ProseMirrorNode[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      // 允許項目間單一空行；若下一非空行仍是同層清單則續，否則結束
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() === "") j++;
      const nextItem = j < lines.length ? matchListItem(lines[j]!) : null;
      if (nextItem && nextItem.indent === baseIndent && nextItem.marker === first.marker) {
        i = j;
        continue;
      }
      break;
    }
    const item = matchListItem(line);
    if (!item || item.indent < baseIndent) break;
    if (item.indent > baseIndent || item.marker !== first.marker) {
      // 巢狀子清單：附加到最後一個 item
      const nested = parseList(lines, i);
      const last = items[items.length - 1];
      if (last) (last.content ??= []).push(nested.node);
      i = nested.next;
      continue;
    }
    // 同層 item
    const itemNode: ProseMirrorNode = isTask
      ? { type: "taskItem", attrs: { checked: item.checked }, content: [paragraph(item.text)] }
      : { type: "listItem", content: [paragraph(item.text)] };
    items.push(itemNode);
    i++;
  }

  const node: ProseMirrorNode = isTask
    ? { type: "taskList", content: items }
    : isOrdered
      ? { type: "orderedList", content: items }
      : { type: "bulletList", content: items };
  return { node, next: i };
}

function buildTable(header: string[], rows: string[][]): ProseMirrorNode {
  const headerRow: ProseMirrorNode = {
    type: "tableRow",
    content: header.map((cell) => ({
      type: "tableHeader",
      content: [paragraph(cell)],
    })),
  };
  const bodyRows: ProseMirrorNode[] = rows.map((cells) => ({
    type: "tableRow",
    content: header.map((_, idx) => ({
      type: "tableCell",
      content: [paragraph(cells[idx] ?? "")],
    })),
  }));
  return { type: "table", content: [headerRow, ...bodyRows] };
}

/** Markdown → ProseMirror doc（canonical）。 */
export function markdownToDoc(markdown: string): ProseMirrorDoc {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const content: ProseMirrorNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // 空行
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 圍欄程式碼區塊
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[2]![0]!; // ` 或 ~
      const lang = fence[3] ?? "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const closing = new RegExp(`^ {0,3}${marker === "`" ? "`{3,}" : "~{3,}"}\\s*$`);
        if (closing.test(lines[i]!)) {
          i++;
          break;
        }
        codeLines.push(lines[i]!);
        i++;
      }
      const code = codeLines.join("\n");
      content.push({
        type: "codeBlock",
        attrs: { language: lang || null },
        ...(code ? { content: [textNode(code)] } : {}),
      });
      continue;
    }

    // ATX 標題
    const atx = ATX_RE.exec(line);
    if (atx) {
      const level = clampHeadingLevel(atx[1]!.length);
      content.push({
        type: "heading",
        attrs: { level },
        ...(atx[2] ? { content: parseInline(atx[2]!) } : {}),
      });
      i++;
      continue;
    }

    // 水平線
    if (HR_RE.test(line)) {
      content.push({ type: "horizontalRule" });
      i++;
      continue;
    }

    // 單獨一行的圖片 → image block
    const img = IMAGE_ONLY_RE.exec(line);
    if (img) {
      content.push({
        type: "image",
        attrs: {
          src: img[2]!,
          alt: img[1] || null,
          title: img[3] ?? null,
        },
      });
      i++;
      continue;
    }

    // 表格（GFM）：本行有 pipe 且下一行為分隔列
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]!)) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
        rows.push(splitTableRow(lines[i]!));
        i++;
      }
      content.push(buildTable(header, rows));
      continue;
    }

    // 引用（含 GitHub admonition → callout）
    const bq = BLOCKQUOTE_RE.exec(line);
    if (bq) {
      const inner: string[] = [];
      while (i < lines.length) {
        const m = BLOCKQUOTE_RE.exec(lines[i]!);
        if (!m) break;
        inner.push(m[1]!);
        i++;
      }
      const admonition = /^\s*\[!(\w+)\]\s*$/.exec(inner[0] ?? "");
      const innerDoc = markdownToDoc(inner.slice(admonition ? 1 : 0).join("\n"));
      const innerNodes = innerDoc.content ?? [];
      if (admonition) {
        const kind = admonition[1]!.toLowerCase();
        content.push({ type: "callout", attrs: { kind }, content: innerNodes });
      } else {
        content.push({
          type: "blockquote",
          content: innerNodes.length > 0 ? innerNodes : [{ type: "paragraph" }],
        });
      }
      continue;
    }

    // 清單
    if (matchListItem(line)) {
      const { node, next } = parseList(lines, i);
      content.push(node);
      i = next;
      continue;
    }

    // 段落：收集連續非空、非特殊行（軟換行以空白接續）
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const l = lines[i]!;
      if (
        l.trim() === "" ||
        FENCE_RE.test(l) ||
        ATX_RE.test(l) ||
        HR_RE.test(l) ||
        BLOCKQUOTE_RE.test(l) ||
        matchListItem(l) ||
        IMAGE_ONLY_RE.test(l) ||
        (l.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]!))
      ) {
        break;
      }
      para.push(l);
      i++;
    }
    content.push(paragraph(para.join(" ")));
  }

  return { type: "doc", content };
}
