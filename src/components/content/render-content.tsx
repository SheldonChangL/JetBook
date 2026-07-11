import { Fragment, type ReactNode } from "react";
import type { ProseMirrorDoc, ProseMirrorNode } from "@/lib/content/types";
import { createHeadingSlugger, headingNodeText } from "@/lib/content/heading-slug";
import { HeadingAnchor } from "@/components/content/heading-anchor";
import { codeLanguageLabel } from "@/lib/content/lowlight";
import { highlightToReact } from "@/lib/content/highlight-to-react";
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
