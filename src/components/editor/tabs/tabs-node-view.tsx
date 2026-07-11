"use client";

import { useEffect, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 分頁區塊節點視圖（D-12，編輯端）：
 * - 上方分頁標籤列（tablist）：每個分頁一個標題輸入框（原生 input，IME 友善）；點按即切換 active。
 * - 右側「＋」新增分頁；每個分頁標題後有「×」刪除（至少保留一個分頁）。
 * - active 分頁為 React 本地狀態（不寫入文件）；以 data-active + CSS nth-child 控制面板顯隱。
 * - 內文面板由 NodeViewContent 承載（各 tabItem 的 renderHTML 產出 .jb-tab-panel）。
 * - 標題文字更新走 setNodeMarkup（不呼叫 focus，避免搶走輸入框焦點）。
 */
export function TabsNodeView({ editor, node, getPos }: NodeViewProps) {
  const t = useTranslations("editor.tabs");
  const count = node.childCount;
  const [active, setActive] = useState(0);
  const current = Math.min(active, Math.max(0, count - 1));

  useEffect(() => {
    if (active !== current) setActive(current);
  }, [active, current]);

  const childStart = (index: number): number | null => {
    if (typeof getPos !== "function") return null;
    const base = getPos();
    if (typeof base !== "number") return null;
    let pos = base + 1;
    for (let k = 0; k < index; k += 1) pos += node.child(k).nodeSize;
    return pos;
  };

  const setLabel = (index: number, label: string) => {
    const pos = childStart(index);
    if (pos === null) return;
    const child = node.child(index);
    editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, { ...child.attrs, label });
        return true;
      })
      .run();
  };

  const addTab = () => {
    if (typeof getPos !== "function") return;
    const base = getPos();
    if (typeof base !== "number") return;
    const at = base + node.nodeSize - 1;
    editor
      .chain()
      .insertContentAt(at, {
        type: "tabItem",
        attrs: { label: "" },
        content: [{ type: "paragraph" }],
      })
      .run();
    setActive(count);
  };

  const removeTab = (index: number) => {
    if (count <= 1) return;
    const pos = childStart(index);
    if (pos === null) return;
    const size = node.child(index).nodeSize;
    editor.chain().deleteRange({ from: pos, to: pos + size }).run();
    setActive(Math.max(0, Math.min(index, count - 2)));
  };

  return (
    <NodeViewWrapper className="jb-tabs" data-active={current}>
      <div
        className="jb-tabs__strip"
        contentEditable={false}
        role="tablist"
        aria-label={t("tabListLabel")}
      >
        {Array.from({ length: count }, (_, i) => {
          const label = String(node.child(i).attrs.label ?? "");
          return (
            <div key={i} className={cn("jb-tabs__tab", i === current && "is-active")}>
              <input
                className="jb-tabs__tab-input"
                value={label}
                placeholder={t("defaultLabel", { n: i + 1 })}
                aria-label={t("defaultLabel", { n: i + 1 })}
                onFocus={() => setActive(i)}
                onChange={(e) => setLabel(i, e.target.value)}
                readOnly={!editor.isEditable}
              />
              {editor.isEditable && count > 1 ? (
                <button
                  type="button"
                  className="jb-tabs__tab-remove"
                  aria-label={t("removeTab")}
                  onClick={() => removeTab(i)}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
          );
        })}
        {editor.isEditable ? (
          <button
            type="button"
            className="jb-tabs__add"
            aria-label={t("addTab")}
            onClick={addTab}
          >
            <Plus className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      <NodeViewContent className="jb-tabs__panels" />
    </NodeViewWrapper>
  );
}
