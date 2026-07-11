import type { ProseMirrorDoc, ProseMirrorNode } from "./types";

/**
 * TipTap JSON → Markdown 與純文字的衍生轉換（架構鐵律 #5）。
 * canonical 是 JSON；此處只做「單向」衍生（匯出 / RAG chunking / 全文索引）。
 * 支援節點：段落、heading(1-3)、清單、任務清單、程式碼區塊、引用、
 *          callout、表格、圖片、附件、水平線；行內：粗/斜/刪除線/行內碼/連結。
 */

function escapeText(text: string): string {
  return text;
}

function serializeInline(node: ProseMirrorNode): string {
  if (node.type === "text") {
    let text = escapeText(node.text ?? "");
    for (const mark of node.marks ?? []) {
      switch (mark.type) {
        case "bold":
          text = `**${text}**`;
          break;
        case "italic":
          text = `*${text}*`;
          break;
        case "strike":
          text = `~~${text}~~`;
          break;
        case "code":
          text = `\`${text}\``;
          break;
        case "link": {
          const href = (mark.attrs?.href as string) ?? "";
          text = `[${text}](${href})`;
          break;
        }
        default:
          break;
      }
    }
    return text;
  }
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(serializeInline).join("");
}

function serializeChildren(nodes: ProseMirrorNode[] | undefined): string {
  return (nodes ?? []).map((n) => serializeBlock(n)).join("\n\n");
}

function serializeListItems(node: ProseMirrorNode, ordered: boolean): string {
  const items = node.content ?? [];
  return items
    .map((item, index) => {
      const marker = ordered ? `${index + 1}.` : "-";
      const inner = (item.content ?? []).map((c) => serializeBlock(c)).join("\n");
      const indented = inner
        .split("\n")
        .map((line, i) => (i === 0 ? `${marker} ${line}` : `  ${line}`))
        .join("\n");
      return indented;
    })
    .join("\n");
}

function serializeBlock(node: ProseMirrorNode): string {
  switch (node.type) {
    case "paragraph":
      return (node.content ?? []).map(serializeInline).join("");
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
      return `${"#".repeat(level)} ${(node.content ?? []).map(serializeInline).join("")}`;
    }
    case "bulletList":
      return serializeListItems(node, false);
    case "orderedList":
      return serializeListItems(node, true);
    case "taskList":
      return (node.content ?? [])
        .map((item) => {
          const checked = item.attrs?.checked ? "x" : " ";
          const inner = (item.content ?? []).map((c) => serializeBlock(c)).join(" ");
          return `- [${checked}] ${inner}`;
        })
        .join("\n");
    case "codeBlock": {
      const lang = (node.attrs?.language as string) ?? "";
      const code = (node.content ?? []).map((c) => c.text ?? "").join("");
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case "blockquote":
      return serializeChildren(node.content)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "callout": {
      const kind = (node.attrs?.kind as string) ?? "info";
      const inner = serializeChildren(node.content);
      return `> [!${kind.toUpperCase()}]\n${inner
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n")}`;
    }
    case "image": {
      const alt = (node.attrs?.alt as string) ?? "";
      const src = (node.attrs?.src as string) ?? "";
      return `![${alt}](${src})`;
    }
    case "attachment": {
      const fileName = (node.attrs?.fileName as string) ?? "";
      const id = (node.attrs?.attachmentId as string) ?? "";
      return `[${fileName}](/api/files/${id})`;
    }
    case "horizontalRule":
      return "---";
    case "table":
      return serializeTable(node);
    case "tabs":
      // D-12：每個分頁序列化為「標題 + 內文」，確保標題文字進全文索引/RAG。
      return (node.content ?? []).map((c) => serializeBlock(c)).join("\n\n");
    case "tabItem": {
      const label = (node.attrs?.label as string) ?? "";
      const body = serializeChildren(node.content);
      return label ? `**${label}**\n\n${body}` : body;
    }
    case "details": {
      // D-12：摘要標題 + 內文（標題文字進全文索引/RAG）。
      const summary = (node.attrs?.summary as string) ?? "";
      const body = serializeChildren(node.content);
      return summary ? `**${summary}**\n\n${body}` : body;
    }
    case "stepper":
      // D-12：步驟序列化為有序清單（序號 = 步驟順序）。
      return (node.content ?? [])
        .map((step, index) => {
          const inner = (step.content ?? []).map((c) => serializeBlock(c)).join("\n");
          return inner
            .split("\n")
            .map((line, i) => (i === 0 ? `${index + 1}. ${line}` : `   ${line}`))
            .join("\n");
        })
        .join("\n");
    case "step":
      return serializeChildren(node.content);
    default:
      // 未知區塊：盡量取出其文字，確保進得了全文索引
      return (node.content ?? []).map((c) => serializeBlock(c)).join("\n\n");
  }
}

function serializeTable(node: ProseMirrorNode): string {
  const rows = node.content ?? [];
  const lines: string[] = [];
  rows.forEach((row, rowIndex) => {
    const cells = (row.content ?? []).map((cell) =>
      (cell.content ?? []).map(serializeBlock).join(" ").replace(/\n/g, " "),
    );
    lines.push(`| ${cells.join(" | ")} |`);
    if (rowIndex === 0) {
      lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    }
  });
  return lines.join("\n");
}

/** doc → Markdown（衍生，供匯出與 RAG chunking）。 */
export function docToMarkdown(doc: ProseMirrorDoc): string {
  return serializeChildren(doc.content).trim();
}

/** doc → 純文字（衍生，餵 pgroonga 全文索引）。 */
export function docToPlainText(node: ProseMirrorDoc | ProseMirrorNode): string {
  if ("text" in node && typeof node.text === "string") return node.text;
  // 附件為 atom 無內文，以檔名代表（讓全文索引可依檔名命中）
  if ((node as ProseMirrorNode).type === "attachment") {
    return String((node as ProseMirrorNode).attrs?.fileName ?? "");
  }
  // D-12：分頁標題（label）與摺疊摘要（summary）存於 attrs，須併入純文字供全文索引/RAG（F-EDIT-13）。
  const pmNode = node as ProseMirrorNode;
  if (pmNode.type === "tabItem" || pmNode.type === "details") {
    const attrKey = pmNode.type === "tabItem" ? "label" : "summary";
    const attrText = String(pmNode.attrs?.[attrKey] ?? "");
    const body = (pmNode.content ?? []).map((c) => docToPlainText(c)).join("\n");
    return [attrText, body].filter(Boolean).join("\n");
  }
  const children = (node as ProseMirrorNode).content ?? [];
  const sep = ["paragraph", "heading", "codeBlock", "listItem", "tableRow"].includes(
    (node as ProseMirrorNode).type,
  )
    ? "\n"
    : " ";
  return children.map((c) => docToPlainText(c)).join(sep);
}
