import { Fragment, type ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { BlockDiffEntry, InlineDiffToken } from "@/lib/content/diff";
import type { ProseMirrorDoc, ProseMirrorNode } from "@/lib/content/types";
import { RenderContent } from "./render-content";

/**
 * 版本差異渲染（E-04，F-VER-04）。
 * 區塊級：新增綠底／刪除紅底刪除線／修改黃底；修改區塊內為字級 diff（del 紅、ins 綠）。
 * 純呈現層——差異計算全在 lib/content/diff.ts。
 */

/** 將單一區塊包成 doc 交給既有唯讀渲染器（保持與閱讀頁一致的樣式）。 */
function renderBlock(block: ProseMirrorNode): ReactNode {
  const doc: ProseMirrorDoc = { type: "doc", content: [block] };
  return <RenderContent doc={doc} />;
}

/** 字級 token：insert 綠、delete 紅刪除線、equal 原樣。 */
function InlineToken({ token }: { token: InlineDiffToken }) {
  if (token.type === "insert") {
    return (
      <ins className="rounded-[2px] bg-success-tint px-0.5 text-success no-underline">
        {token.text}
      </ins>
    );
  }
  if (token.type === "delete") {
    return (
      <del className="rounded-[2px] bg-danger-tint px-0.5 text-danger line-through">
        {token.text}
      </del>
    );
  }
  return <span>{token.text}</span>;
}

/** 修改區塊：以字級 token 重繪內容，heading 保留層級標記。 */
function ModifiedBlock({ entry }: { entry: BlockDiffEntry }) {
  const node = entry.newBlock ?? entry.oldBlock;
  const tokens = entry.inline ?? [];
  const inner = tokens.map((token, i) => <InlineToken key={i} token={token} />);

  if (node?.type === "heading") {
    const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
    const Tag = `h${level}` as "h1" | "h2" | "h3";
    return (
      <div className="prose-editor max-w-none">
        <Tag className="whitespace-pre-wrap">{inner}</Tag>
      </div>
    );
  }
  return (
    <div className="prose-editor max-w-none">
      <p className="whitespace-pre-wrap">{inner}</p>
    </div>
  );
}

/** 圖例：新增／刪除／修改三色說明。 */
export async function DiffLegend() {
  const t = await getTranslations("versionHistory");
  const items: Array<{ key: string; label: string; swatch: string }> = [
    { key: "added", label: t("diffLegendAdded"), swatch: "border-success bg-success-tint" },
    { key: "removed", label: t("diffLegendRemoved"), swatch: "border-danger bg-danger-tint" },
    { key: "modified", label: t("diffLegendModified"), swatch: "border-warning bg-warning-tint" },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-4">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5 text-caption text-fg-secondary">
          <span aria-hidden className={`size-3 rounded-[3px] border-l-2 ${item.swatch}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** 差異主體：逐頂層區塊依狀態上色渲染。 */
export function DiffContent({ entries }: { entries: BlockDiffEntry[] }) {
  return (
    <div className="flex flex-col gap-1">
      {entries.map((entry, i) => {
        switch (entry.status) {
          case "added":
            return (
              <div
                key={i}
                className="rounded-sm border-l-2 border-success bg-success-tint px-4 py-1"
                data-diff="added"
              >
                {entry.newBlock ? renderBlock(entry.newBlock) : null}
              </div>
            );
          case "removed":
            return (
              <div
                key={i}
                className="rounded-sm border-l-2 border-danger bg-danger-tint px-4 py-1 text-fg-secondary line-through decoration-danger/50"
                data-diff="removed"
              >
                {entry.oldBlock ? renderBlock(entry.oldBlock) : null}
              </div>
            );
          case "modified":
            return (
              <div
                key={i}
                className="rounded-sm border-l-2 border-warning bg-warning-tint px-4 py-1"
                data-diff="modified"
              >
                <ModifiedBlock entry={entry} />
              </div>
            );
          default:
            return (
              <div
                key={i}
                className="border-l-2 border-transparent px-4 py-1 text-fg-secondary"
                data-diff="equal"
              >
                {entry.newBlock ? renderBlock(entry.newBlock) : null}
              </div>
            );
        }
      })}
    </div>
  );
}

/** 空差異提示的統一容器。 */
export function DiffEmpty({ children }: { children: ReactNode }) {
  return (
    <Fragment>
      <p className="text-body text-fg-tertiary">{children}</p>
    </Fragment>
  );
}
