import { Fragment, type ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { ProseMirrorDoc, ProseMirrorNode } from "@/lib/content/types";
import type { ResolvedPageLink } from "@/lib/pages/link-resolve";
import { createHeadingSlugger, headingNodeText } from "@/lib/content/heading-slug";
import { HeadingAnchor } from "@/components/content/heading-anchor";
import { codeLanguageLabel } from "@/lib/content/lowlight";
import { highlightToReact } from "@/lib/content/highlight-to-react";
import { normalizeCalloutKind } from "@/lib/content/callout";
import { MERMAID_NODE_NAME } from "@/lib/content/mermaid";
import { isEmbedUrlAllowed, normalizeEmbedUrl, parseHttpUrl } from "@/lib/content/embed";
import { CALLOUT_ICONS } from "@/components/content/callout-icons";
import { CodeBlockReader } from "./code-block-reader";
import { ContentImage } from "./content-image";
import { ContentAttachment } from "./content-attachment";
import { ContentTabs } from "./content-tabs";
import { ContentEmbed } from "./content-embed";
import { MermaidDiagram } from "./mermaid-diagram";

/**
 * TipTap JSON → React 元素（閱讀模式渲染，G-02）。
 * 與編輯器 schema 對應，套用 .prose-editor 樣式，與編輯畫面視覺一致。
 * 進階區塊（表格/callout/圖片…）隨 D-03~D-14 擴充對應 case。
 * 標題加穩定 id（文字 slug + 去重）與 hover 複製錨點鈕（G-05）。
 *
 * D-11：頁面連結（pageLink）以 attrs.id（page id）為錨，改名不失效——由呼叫端（RSC）
 * 先以 `resolvePageLinkTargets` 解析出「現行 slug/title」的 Map，經 `links` prop 注入；
 * 未解析到（不可讀／已刪除）者退回作者插入時的 label 快照，且不連結。
 */

type Slugger = (text: string) => string;

/** 頁面連結解析結果：pageId → 目標狀態（現行連結或死鏈，D-11 / C-13）。 */
export type PageLinkMap = ReadonlyMap<string, ResolvedPageLink>;

/** C-13：死鏈 chip 的 i18n 文案（於 RenderContent 一次取得後沿 ctx 下傳）。 */
interface DeadLinkLabels {
  /** chip 文字（「已刪除頁面」） */
  label: string;
  /** 無還原權限時的 tooltip */
  tooltip: string;
  /** 有還原權限時的 tooltip（點擊前往回收桶還原） */
  restore: string;
}

/**
 * 渲染上下文：slug 產生器 + 頁面連結解析 Map（D-11）+ Embed 白名單（D-14）。
 * embed 的「iframe/連結卡片」判斷須於渲染當下依白名單推導，故白名單須隨遞迴傳遞
 * （含巢狀於 details/tabs/stepper 內的 embed），避免巢狀嵌入誤退化為卡片。
 */
interface RenderCtx {
  slug: Slugger;
  links: PageLinkMap | undefined;
  deadLink: DeadLinkLabels;
  embedAllowedDomains: readonly string[];
}

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

/** D-11：@mention chip（`@姓名`，label 快照；非連結）。 */
const MENTION_SIGIL = "@";

function renderMention(node: ProseMirrorNode, key: number): ReactNode {
  const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
  // `@` 為 mention 語法符號（非可翻譯 UI 文案）；於 JS 端組字串再輸出，避免命中 i18n JSX 規則。
  const display = MENTION_SIGIL + label;
  return (
    <span key={key} className="jb-mention" data-type="mention">
      {display}
    </span>
  );
}

/**
 * D-11 / C-13：頁面連結渲染。
 * - `resolved`：連結至現行目標（現行標題，改名自動更新）。
 * - `deleted`（死鏈，C-13）：「已刪除頁面」chip（灰刪除線＋tooltip）；具還原權限者外層為
 *   連結，直達回收桶還原（還原後目標復活，下次渲染自動回 resolved）。
 * - 未解析（不可讀 space／已清除）：退回作者插入時的 label 快照、不連結。
 */
function renderPageLink(node: ProseMirrorNode, key: number, ctx: RenderCtx): ReactNode {
  const pageId = typeof node.attrs?.id === "string" ? node.attrs.id : "";
  const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
  const resolved = pageId ? ctx.links?.get(pageId) : undefined;

  if (resolved?.status === "resolved") {
    return (
      <a key={key} className="jb-page-link" data-type="pageLink" href={resolved.href}>
        {resolved.title}
      </a>
    );
  }

  if (resolved?.status === "deleted") {
    const chipClass = "jb-page-link jb-page-link--deleted";
    // 具還原權限：chip 本身為連結，直達回收桶（限定該 space）；tooltip 提示可還原。
    if (resolved.canRestore && resolved.trashHref) {
      return (
        <a
          key={key}
          className={chipClass}
          data-type="pageLink"
          data-deleted=""
          href={resolved.trashHref}
          title={ctx.deadLink.restore}
        >
          {ctx.deadLink.label}
        </a>
      );
    }
    // 無還原權限：僅 chip、不提供還原入口（非連結）。
    return (
      <span
        key={key}
        className={chipClass}
        data-type="pageLink"
        data-deleted=""
        title={ctx.deadLink.tooltip}
      >
        {ctx.deadLink.label}
      </span>
    );
  }

  return (
    <span key={key} className="jb-page-link jb-page-link--unresolved" data-type="pageLink">
      {label}
    </span>
  );
}

function renderChildren(nodes: ProseMirrorNode[] | undefined, ctx: RenderCtx): ReactNode {
  return (nodes ?? []).map((node, i) => renderNode(node, i, ctx));
}

/**
 * D-13：Mermaid 圖表區塊渲染（client 元件，mermaid 依賴 DOM；語法錯誤顯示錯誤框不崩頁）。
 * `mermaid` 節點與舊資料的 `codeBlock`(language=mermaid)（#245）共用同一渲染。空原始碼不輸出。
 */
function renderMermaidBlock(source: string, key: number): ReactNode {
  if (!source.trim()) return <Fragment key={key} />;
  return (
    <div key={key} className="jb-mermaid" data-mermaid="">
      <MermaidDiagram source={source} zoomable />
    </div>
  );
}

function renderInline(nodes: ProseMirrorNode[] | undefined, ctx: RenderCtx): ReactNode {
  return (nodes ?? []).map((node, i) => {
    if (node.type === "text") return renderMarks(node.text ?? "", node.marks, i);
    if (node.type === "hardBreak") return <br key={i} />;
    if (node.type === "mention") return renderMention(node, i);
    if (node.type === "pageLink") return renderPageLink(node, i, ctx);
    return <Fragment key={i}>{renderInline(node.content, ctx)}</Fragment>;
  });
}

function renderNode(node: ProseMirrorNode, key: number, ctx: RenderCtx): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{renderInline(node.content, ctx)}</p>;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
      const Tag = (`h${level}` as "h1" | "h2" | "h3");
      const id = ctx.slug(headingNodeText(node));
      return (
        <Tag key={key} id={id} className="group relative scroll-mt-20">
          {renderInline(node.content, ctx)}
          <HeadingAnchor id={id} />
        </Tag>
      );
    }
    case "bulletList":
      return <ul key={key}>{renderChildren(node.content, ctx)}</ul>;
    case "orderedList":
      return <ol key={key}>{renderChildren(node.content, ctx)}</ol>;
    case "listItem":
      return <li key={key}>{renderChildren(node.content, ctx)}</li>;
    case "taskList":
      return (
        <ul key={key} data-type="taskList">
          {renderChildren(node.content, ctx)}
        </ul>
      );
    case "taskItem":
      return (
        <li key={key} data-checked={node.attrs?.checked ? "true" : "false"}>
          <label>
            <input type="checkbox" defaultChecked={Boolean(node.attrs?.checked)} disabled />
          </label>
          <div>{renderChildren(node.content, ctx)}</div>
        </li>
      );
    case "blockquote":
      return <blockquote key={key}>{renderChildren(node.content, ctx)}</blockquote>;
    case "callout": {
      // D-06：與編輯端共用 .jb-callout 樣式（左緣色條 + 淡底，依 data-kind 取語意 token）。
      const kind = normalizeCalloutKind(node.attrs?.kind);
      const Icon = CALLOUT_ICONS[kind];
      return (
        <div key={key} className="jb-callout" data-kind={kind}>
          <span className="jb-callout__icon" aria-hidden>
            <Icon />
          </span>
          <div className="jb-callout__body">{renderChildren(node.content, ctx)}</div>
        </div>
      );
    }
    case "codeBlock": {
      const code = (node.content ?? []).map((c) => c.text ?? "").join("");
      const language = (node.attrs?.language as string | null | undefined) ?? null;
      // 舊資料相容（#245）：轉換器修正前，```mermaid 圍籬被存為 codeBlock(language=mermaid)。
      // 閱讀端一律以圖表渲染，使既有頁面免逐頁重存即正確顯示（新內容已存為 mermaid 節點）。
      if (language && language.toLowerCase() === MERMAID_NODE_NAME) {
        return renderMermaidBlock(code, key);
      }
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
            <tbody>{renderChildren(node.content, ctx)}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr key={key}>{renderChildren(node.content, ctx)}</tr>;
    case "tableHeader":
      return (
        <th key={key} {...cellSpanProps(node)}>
          {renderChildren(node.content, ctx)}
        </th>
      );
    case "tableCell":
      return (
        <td key={key} {...cellSpanProps(node)}>
          {renderChildren(node.content, ctx)}
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
    case "mermaid": {
      const source = typeof node.attrs?.source === "string" ? node.attrs.source : "";
      return renderMermaidBlock(source, key);
    }
    case "embed": {
      // D-14：閱讀端依白名單決定 iframe 嵌入或退化連結卡片（判斷於此當下推導，不信任文件內舊狀態）。
      const url = normalizeEmbedUrl(node.attrs?.url);
      if (!url) return <Fragment key={key} />;
      // 縱深防禦：先在伺服端過濾為合法 http(s) URL，才傳入 client 元件——非法 scheme
      // （javascript:/data: 等）於閱讀端一律不輸出，且不會被序列化進 client props/flight。
      const parsed = parseHttpUrl(url);
      if (!parsed) return <Fragment key={key} />;
      const allowed = isEmbedUrlAllowed(parsed.href, ctx.embedAllowedDomains);
      return <ContentEmbed key={key} url={parsed.href} allowed={allowed} />;
    }
    case "horizontalRule":
      return <hr key={key} />;
    case "tabs": {
      // D-12：分頁區塊。伺服端算好各分頁內文，交由 client ContentTabs 切換。
      const tabs = (node.content ?? [])
        .filter((c) => c.type === "tabItem")
        .map((item) => ({
          label: typeof item.attrs?.label === "string" ? item.attrs.label : "",
          content: renderChildren(item.content, ctx),
        }));
      if (!tabs.length) return <Fragment key={key} />;
      return <ContentTabs key={key} tabs={tabs} />;
    }
    case "details": {
      // D-12：摺疊區塊。以原生 <details> 渲染，瀏覽器原生互動（open 為作者預設）。
      const open = node.attrs?.open !== false;
      const summary = typeof node.attrs?.summary === "string" ? node.attrs.summary : "";
      return (
        <details key={key} className="jb-details" open={open}>
          <summary className="jb-details__summary-reader">{summary}</summary>
          <div className="jb-details__body">{renderChildren(node.content, ctx)}</div>
        </details>
      );
    }
    case "stepper": {
      // D-12：步驟區塊。序號由 CSS counter（.jb-step::before）產生，與編輯端一致。
      const steps = (node.content ?? []).filter((c) => c.type === "step");
      if (!steps.length) return <Fragment key={key} />;
      return (
        <div key={key} className="jb-stepper">
          {steps.map((step, i) => (
            <div key={i} className="jb-step">
              <div className="jb-step__body">{renderChildren(step.content, ctx)}</div>
            </div>
          ))}
        </div>
      );
    }
    // D-11：mention / pageLink 為 inline atom，正常出現在段落等 inline 內文（renderInline 處理）；
    // 若因資料異常出現在區塊層，於此保底渲染，避免落入 default 丟失內容。
    case "mention":
      return renderMention(node, key);
    case "pageLink":
      return renderPageLink(node, key, ctx);
    default:
      return <Fragment key={key}>{renderChildren(node.content, ctx)}</Fragment>;
  }
}

export async function RenderContent({
  doc,
  links,
  embedAllowedDomains = [],
}: {
  doc: ProseMirrorDoc | null;
  /** D-11 / C-13：頁面連結解析 Map（pageId → 現行連結或死鏈）。未提供時連結退回 label 快照。 */
  links?: PageLinkMap;
  /** Embed 白名單網域（env EMBED_ALLOWED_DOMAINS）；未提供＝空白名單，嵌入一律退化為連結卡片（D-14）。 */
  embedAllowedDomains?: readonly string[];
}) {
  if (!doc?.content?.length) return null;
  const t = await getTranslations("reading");
  const ctx: RenderCtx = {
    slug: createHeadingSlugger(),
    links,
    embedAllowedDomains,
    deadLink: {
      label: t("deadLink.label"),
      tooltip: t("deadLink.tooltip"),
      restore: t("deadLink.restore"),
    },
  };
  return (
    <div className="prose-editor archive-content-renderer max-w-none">
      {renderChildren(doc.content, ctx)}
    </div>
  );
}
