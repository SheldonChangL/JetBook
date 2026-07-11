import { Fragment, type ReactNode } from "react";
import type { ProseMirrorDoc, ProseMirrorNode } from "@/lib/content/types";
import { codeLanguageLabel } from "@/lib/content/lowlight";
import { highlightToReact } from "@/lib/content/highlight-to-react";
import { CodeBlockReader } from "./code-block-reader";
import { ContentImage } from "./content-image";

/**
 * TipTap JSON → React 元素（閱讀模式渲染，G-02）。
 * 與編輯器 schema 對應，套用 .prose-editor 樣式，與編輯畫面視覺一致。
 * 進階區塊（表格/callout/圖片…）隨 D-03~D-14 擴充對應 case。
 */

/**
 * 由首列儲存格的 colwidth 屬性推導 <colgroup>（D-05）：
 * 保留編輯端欄寬拖曳的結果；無任何寬度時回傳 null（交由自動版面）。
 */
function renderColgroup(table: ProseMirrorNode, key: number): ReactNode {
  const firstRow = (table.content ?? [])[0];
  if (!firstRow) return null;
  const widths: (number | null)[] = [];
  for (const cell of firstRow.content ?? []) {
    const span = Number(cell.attrs?.colspan ?? 1) || 1;
    const colwidth = cell.attrs?.colwidth;
    for (let i = 0; i < span; i += 1) {
      const w = Array.isArray(colwidth) ? colwidth[i] : null;
      widths.push(typeof w === "number" && w > 0 ? w : null);
    }
  }
  if (!widths.some((w) => w !== null)) return null;
  return (
    <colgroup key={key}>
      {widths.map((w, i) => (
        <col key={i} style={w !== null ? { width: `${w}px` } : undefined} />
      ))}
    </colgroup>
  );
}

function cellSpanProps(node: ProseMirrorNode): { colSpan?: number; rowSpan?: number } {
  const colspan = Number(node.attrs?.colspan ?? 1) || 1;
  const rowspan = Number(node.attrs?.rowspan ?? 1) || 1;
  return {
    colSpan: colspan > 1 ? colspan : undefined,
    rowSpan: rowspan > 1 ? rowspan : undefined,
  };
}

function renderMarks(text: string, marks: ProseMirrorNode["marks"], key: number): ReactNode {
  let node: ReactNode = text;
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
        node = <strong>{node}</strong>;
        break;
      case "italic":
        node = <em>{node}</em>;
        break;
      case "strike":
        node = <s>{node}</s>;
        break;
      case "code":
        node = <code>{node}</code>;
        break;
      case "link":
        node = (
          <a href={String(mark.attrs?.href ?? "#")} rel="noreferrer noopener">
            {node}
          </a>
        );
        break;
      default:
        break;
    }
  }
  return <Fragment key={key}>{node}</Fragment>;
}

function renderChildren(nodes: ProseMirrorNode[] | undefined): ReactNode {
  return (nodes ?? []).map((node, i) => renderNode(node, i));
}

function renderInline(nodes: ProseMirrorNode[] | undefined): ReactNode {
  return (nodes ?? []).map((node, i) => {
    if (node.type === "text") return renderMarks(node.text ?? "", node.marks, i);
    if (node.type === "hardBreak") return <br key={i} />;
    return <Fragment key={i}>{renderInline(node.content)}</Fragment>;
  });
}

function renderNode(node: ProseMirrorNode, key: number): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{renderInline(node.content)}</p>;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
      const Tag = (`h${level}` as "h1" | "h2" | "h3");
      return <Tag key={key}>{renderInline(node.content)}</Tag>;
    }
    case "bulletList":
      return <ul key={key}>{renderChildren(node.content)}</ul>;
    case "orderedList":
      return <ol key={key}>{renderChildren(node.content)}</ol>;
    case "listItem":
      return <li key={key}>{renderChildren(node.content)}</li>;
    case "taskList":
      return (
        <ul key={key} data-type="taskList">
          {renderChildren(node.content)}
        </ul>
      );
    case "taskItem":
      return (
        <li key={key} data-checked={node.attrs?.checked ? "true" : "false"}>
          <label>
            <input type="checkbox" defaultChecked={Boolean(node.attrs?.checked)} disabled />
          </label>
          <div>{renderChildren(node.content)}</div>
        </li>
      );
    case "blockquote":
      return <blockquote key={key}>{renderChildren(node.content)}</blockquote>;
    case "codeBlock": {
      const code = (node.content ?? []).map((c) => c.text ?? "").join("");
      const language = (node.attrs?.language as string | null | undefined) ?? null;
      return (
        <CodeBlockReader
          key={key}
          code={code}
          languageLabel={codeLanguageLabel(language)}
        >
          {highlightToReact(code, language)}
        </CodeBlockReader>
      );
    }
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      // 安全：只渲染同源上傳圖片（/api/files/），外部或被竄改的 src 一律不輸出
      if (!src.startsWith("/api/files/")) return <Fragment key={key} />;
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return <ContentImage key={key} src={src} alt={alt} />;
    }
    case "table":
      // 閱讀端水平捲動（F-EDIT-07）：以 overflow-x-auto 包裹，寬表格不撐破版面。
      return (
        <div key={key} className="tableWrapper overflow-x-auto">
          <table>
            {renderColgroup(node, 0)}
            <tbody>{renderChildren(node.content)}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr key={key}>{renderChildren(node.content)}</tr>;
    case "tableHeader":
      return (
        <th key={key} {...cellSpanProps(node)}>
          {renderChildren(node.content)}
        </th>
      );
    case "tableCell":
      return (
        <td key={key} {...cellSpanProps(node)}>
          {renderChildren(node.content)}
        </td>
      );
    case "horizontalRule":
      return <hr key={key} />;
    default:
      return <Fragment key={key}>{renderChildren(node.content)}</Fragment>;
  }
}

export function RenderContent({ doc }: { doc: ProseMirrorDoc | null }) {
  if (!doc?.content?.length) return null;
  return <div className="prose-editor max-w-none">{renderChildren(doc.content)}</div>;
}
