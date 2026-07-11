import { Fragment, type ReactNode } from "react";
import type { ProseMirrorDoc, ProseMirrorNode } from "@/lib/content/types";
import { createHeadingSlugger, headingNodeText } from "@/lib/content/heading-slug";
import { HeadingAnchor } from "@/components/content/heading-anchor";
import { codeLanguageLabel } from "@/lib/content/lowlight";
import { highlightToReact } from "@/lib/content/highlight-to-react";
import { normalizeCalloutKind } from "@/lib/content/callout";
import { CALLOUT_ICONS } from "@/components/content/callout-icons";
import { CodeBlockReader } from "./code-block-reader";
import { ContentImage } from "./content-image";
import { ContentAttachment } from "./content-attachment";

/**
 * TipTap JSON → React 元素（閱讀模式渲染，G-02）。
 * 與編輯器 schema 對應，套用 .prose-editor 樣式，與編輯畫面視覺一致。
 * 進階區塊（表格/callout/圖片…）隨 D-03~D-14 擴充對應 case。
 * 標題加穩定 id（文字 slug + 去重）與 hover 複製錨點鈕（G-05）。
 */

type Slugger = (text: string) => string;

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

function renderChildren(nodes: ProseMirrorNode[] | undefined, slug: Slugger): ReactNode {
  return (nodes ?? []).map((node, i) => renderNode(node, i, slug));
}

function renderInline(nodes: ProseMirrorNode[] | undefined): ReactNode {
  return (nodes ?? []).map((node, i) => {
    if (node.type === "text") return renderMarks(node.text ?? "", node.marks, i);
    if (node.type === "hardBreak") return <br key={i} />;
    return <Fragment key={i}>{renderInline(node.content)}</Fragment>;
  });
}

function renderNode(node: ProseMirrorNode, key: number, slug: Slugger): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{renderInline(node.content)}</p>;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
      const Tag = (`h${level}` as "h1" | "h2" | "h3");
      const id = slug(headingNodeText(node));
      return (
        <Tag key={key} id={id} className="group relative scroll-mt-20">
          {renderInline(node.content)}
          <HeadingAnchor id={id} />
        </Tag>
      );
    }
    case "bulletList":
      return <ul key={key}>{renderChildren(node.content, slug)}</ul>;
    case "orderedList":
      return <ol key={key}>{renderChildren(node.content, slug)}</ol>;
    case "listItem":
      return <li key={key}>{renderChildren(node.content, slug)}</li>;
    case "taskList":
      return (
        <ul key={key} data-type="taskList">
          {renderChildren(node.content, slug)}
        </ul>
      );
    case "taskItem":
      return (
        <li key={key} data-checked={node.attrs?.checked ? "true" : "false"}>
          <label>
            <input type="checkbox" defaultChecked={Boolean(node.attrs?.checked)} disabled />
          </label>
          <div>{renderChildren(node.content, slug)}</div>
        </li>
      );
    case "blockquote":
      return <blockquote key={key}>{renderChildren(node.content, slug)}</blockquote>;
    case "callout": {
      // D-06：與編輯端共用 .jb-callout 樣式（左緣色條 + 淡底，依 data-kind 取語意 token）。
      const kind = normalizeCalloutKind(node.attrs?.kind);
      const Icon = CALLOUT_ICONS[kind];
      return (
        <div key={key} className="jb-callout" data-kind={kind}>
          <span className="jb-callout__icon" aria-hidden>
            <Icon />
          </span>
          <div className="jb-callout__body">{renderChildren(node.content, slug)}</div>
        </div>
      );
    }
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
            <tbody>{renderChildren(node.content, slug)}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr key={key}>{renderChildren(node.content, slug)}</tr>;
    case "tableHeader":
      return (
        <th key={key} {...cellSpanProps(node)}>
          {renderChildren(node.content, slug)}
        </th>
      );
    case "tableCell":
      return (
        <td key={key} {...cellSpanProps(node)}>
          {renderChildren(node.content, slug)}
        </td>
      );
    case "attachment": {
      const attachmentId =
        typeof node.attrs?.attachmentId === "string" ? node.attrs.attachmentId : "";
      // attachmentId 缺失（資料異常）不輸出；有效者由 /api/files 下載 API 驗權限
      if (!attachmentId) return <Fragment key={key} />;
      const fileName = typeof node.attrs?.fileName === "string" ? node.attrs.fileName : "";
      const sizeBytes = typeof node.attrs?.sizeBytes === "number" ? node.attrs.sizeBytes : 0;
      return (
        <ContentAttachment
          key={key}
          attachmentId={attachmentId}
          fileName={fileName}
          sizeBytes={sizeBytes}
        />
      );
    }
    case "horizontalRule":
      return <hr key={key} />;
    default:
      return <Fragment key={key}>{renderChildren(node.content, slug)}</Fragment>;
  }
}

export function RenderContent({ doc }: { doc: ProseMirrorDoc | null }) {
  if (!doc?.content?.length) return null;
  const slug = createHeadingSlugger();
  return <div className="prose-editor max-w-none">{renderChildren(doc.content, slug)}</div>;
}
