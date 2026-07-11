"use client";

import { Fragment, type ReactNode } from "react";
import { marked, type Token, type Tokens } from "marked";
import { splitCitations } from "@/lib/ai/citations";
import { safeUrl } from "@/lib/ai/safe-url";
import { cn } from "@/lib/utils";

/**
 * AI 回答的 Markdown + 引用渲染（I-03）。
 *
 * 以 marked 的 lexer 取得 token 樹，再走訪產出 React 元素——**不使用**
 * dangerouslySetInnerHTML，避免把 LLM／文件內容當 HTML 注入（安全）。
 * 文字節點以 splitCitations 把 `[n]` 換成可點擊的上標 chip（F-AI-05）。
 *
 * 支援子集：段落、H1–H3、有序/無序清單、引用、程式碼區塊、水平線；
 * 行內：粗體/斜體/刪除線/行內碼/連結/硬換行。串流中的不完整 Markdown 亦可安全渲染。
 */

export interface AnswerContentProps {
  /** 目前累積的回答文字（Markdown）。 */
  text: string;
  /** 點擊內文引用 chip [n] 時觸發（供捲動至對應來源卡片）。 */
  onCite?: (n: number) => void;
  /** 引用 chip 的無障礙標籤（經 i18n，如「來源 1」）。 */
  citeLabel?: (n: number) => string;
}

interface InlineCtx {
  onCite?: (n: number) => void;
  citeLabel?: (n: number) => string;
}

let inlineKey = 0;

function CiteChip({ n, ctx }: { n: number; ctx: InlineCtx }): ReactNode {
  const label = ctx.citeLabel?.(n) ?? String(n);
  return (
    <button
      type="button"
      onClick={ctx.onCite ? () => ctx.onCite?.(n) : undefined}
      title={label}
      aria-label={label}
      className="mx-px inline-flex h-[15px] min-w-[15px] cursor-pointer items-center justify-center rounded-xs bg-ai-tint px-[3px] align-super text-[10px] font-semibold leading-none text-ai transition-shadow hover:ring-[1.5px] hover:ring-ai"
    >
      {n}
    </button>
  );
}

/** 純文字 → 文字 + 引用 chip 交錯節點。 */
function renderText(text: string, ctx: InlineCtx): ReactNode[] {
  return splitCitations(text).map((seg) =>
    seg.type === "text" ? (
      <Fragment key={inlineKey++}>{seg.value}</Fragment>
    ) : (
      <CiteChip key={inlineKey++} n={seg.n} ctx={ctx} />
    ),
  );
}

function renderInline(tokens: Token[] | undefined, ctx: InlineCtx): ReactNode[] {
  const out: ReactNode[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        if (t.tokens && t.tokens.length > 0) out.push(...renderInline(t.tokens, ctx));
        else out.push(...renderText(t.text, ctx));
        break;
      }
      case "escape":
        out.push(...renderText((token as Tokens.Escape).text, ctx));
        break;
      case "strong":
        out.push(
          <strong key={inlineKey++} className="font-semibold">
            {renderInline((token as Tokens.Strong).tokens, ctx)}
          </strong>,
        );
        break;
      case "em":
        out.push(<em key={inlineKey++}>{renderInline((token as Tokens.Em).tokens, ctx)}</em>);
        break;
      case "del":
        out.push(<del key={inlineKey++}>{renderInline((token as Tokens.Del).tokens, ctx)}</del>);
        break;
      case "codespan":
        out.push(
          <code
            key={inlineKey++}
            className="rounded-xs bg-hover px-1 py-0.5 font-mono text-[0.9em]"
          >
            {(token as Tokens.Codespan).text}
          </code>,
        );
        break;
      case "link": {
        const link = token as Tokens.Link;
        const href = safeUrl(link.href);
        // 不安全或空的連結降級為純文字（保留可讀文字，不產生可點擊的惡意連結）。
        if (href === null) {
          out.push(<Fragment key={inlineKey++}>{renderInline(link.tokens, ctx)}</Fragment>);
        } else {
          out.push(
            <a
              key={inlineKey++}
              href={href}
              className="text-primary underline-offset-2 hover:underline"
            >
              {renderInline(link.tokens, ctx)}
            </a>,
          );
        }
        break;
      }
      case "br":
        out.push(<br key={inlineKey++} />);
        break;
      default: {
        const generic = token as { tokens?: Token[]; text?: string };
        if (generic.tokens && generic.tokens.length > 0) out.push(...renderInline(generic.tokens, ctx));
        else if (typeof generic.text === "string") out.push(...renderText(generic.text, ctx));
      }
    }
  }
  return out;
}

function renderListItems(list: Tokens.List, ctx: InlineCtx): ReactNode[] {
  return list.items.map((item, i) => (
    <li key={i} className="mb-1">
      {item.tokens.map((child, j) =>
        child.type === "text" ? (
          <Fragment key={j}>{renderInline((child as Tokens.Text).tokens, ctx)}</Fragment>
        ) : (
          <Fragment key={j}>{renderBlocks([child], ctx)}</Fragment>
        ),
      )}
    </li>
  ));
}

function renderBlocks(tokens: Token[] | undefined, ctx: InlineCtx): ReactNode[] {
  const out: ReactNode[] = [];
  let blockKey = 0;
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "space":
      case "def":
        break;
      case "heading": {
        const h = token as Tokens.Heading;
        const level = Math.min(Math.max(h.depth, 1), 3);
        const className =
          level === 1 ? "mb-2 mt-3 text-h4 font-semibold" : "mb-1.5 mt-3 text-body-ui font-semibold";
        const inner = renderInline(h.tokens, ctx);
        out.push(
          level === 1 ? (
            <h3 key={blockKey++} className={className}>
              {inner}
            </h3>
          ) : level === 2 ? (
            <h4 key={blockKey++} className={className}>
              {inner}
            </h4>
          ) : (
            <h5 key={blockKey++} className={className}>
              {inner}
            </h5>
          ),
        );
        break;
      }
      case "paragraph":
        out.push(
          <p key={blockKey++} className="mb-2.5 last:mb-0">
            {renderInline((token as Tokens.Paragraph).tokens, ctx)}
          </p>,
        );
        break;
      case "text": {
        const t = token as Tokens.Text;
        out.push(
          <p key={blockKey++} className="mb-2.5 last:mb-0">
            {t.tokens && t.tokens.length > 0
              ? renderInline(t.tokens, ctx)
              : renderText(t.text, ctx)}
          </p>,
        );
        break;
      }
      case "list": {
        const list = token as Tokens.List;
        const items = renderListItems(list, ctx);
        out.push(
          list.ordered ? (
            <ol key={blockKey++} className="mb-2.5 list-decimal pl-5 last:mb-0">
              {items}
            </ol>
          ) : (
            <ul key={blockKey++} className="mb-2.5 list-disc pl-5 last:mb-0">
              {items}
            </ul>
          ),
        );
        break;
      }
      case "blockquote":
        out.push(
          <blockquote
            key={blockKey++}
            className="mb-2.5 border-l-2 border-edge-strong pl-3 text-fg-secondary last:mb-0"
          >
            {renderBlocks((token as Tokens.Blockquote).tokens, ctx)}
          </blockquote>,
        );
        break;
      case "code":
        out.push(
          <pre
            key={blockKey++}
            className="mb-2.5 overflow-x-auto rounded-sm bg-hover p-3 font-mono text-code last:mb-0"
          >
            <code>{(token as Tokens.Code).text}</code>
          </pre>,
        );
        break;
      case "hr":
        out.push(<hr key={blockKey++} className="my-3 border-edge" />);
        break;
      default: {
        const generic = token as { tokens?: Token[] };
        if (generic.tokens && generic.tokens.length > 0)
          out.push(...renderBlocks(generic.tokens, ctx));
      }
    }
  }
  return out;
}

export function AnswerContent({ text, onCite, citeLabel }: AnswerContentProps): ReactNode {
  inlineKey = 0;
  const ctx: InlineCtx = { onCite, citeLabel };
  const tokens = marked.lexer(text, { gfm: true });
  return <div className={cn("text-body-ui leading-6 text-fg")}>{renderBlocks(tokens, ctx)}</div>;
}
