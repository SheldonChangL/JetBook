"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeMermaidSource } from "@/lib/content/mermaid";
import { MermaidDiagram } from "@/components/content/mermaid-diagram";

/** 預覽防抖：邊打字邊渲染，避免每次擊鍵都重繪（F-EDIT-14 即時預覽）。 */
const PREVIEW_DEBOUNCE_MS = 300;

/**
 * Mermaid 圖表節點視圖（D-13，編輯端）：
 * - 上：原始碼 textarea（原生元件，IME 友善；停止鍵盤事件冒泡，避免 ProseMirror 攔截 Enter 等）。
 * - 下：即時預覽（防抖渲染）；語法錯誤顯示錯誤框而非崩頁（try/catch 在 MermaidDiagram 內）。
 * - atom 節點：整區以 contentEditable=false 包裹，textarea 自行管理輸入；拖曳把手可搬移區塊。
 */
export function MermaidNodeView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const t = useTranslations("editor.mermaid");
  const source = normalizeMermaidSource(node.attrs.source);

  return (
    <NodeViewWrapper
      as="div"
      className={cn("jb-mermaid jb-mermaid--edit", selected && "is-selected")}
      data-mermaid=""
    >
      <div className="jb-mermaid__editor" contentEditable={false}>
        <div className="jb-mermaid__header">
          {editor.isEditable ? (
            <span
              className="jb-mermaid__drag"
              data-drag-handle
              aria-hidden
              contentEditable={false}
            >
              <GripVertical className="size-4" />
            </span>
          ) : null}
          <span className="jb-mermaid__label">{t("sourceLabel")}</span>
        </div>
        <textarea
          className="jb-mermaid__source"
          value={source}
          placeholder={t("sourcePlaceholder")}
          aria-label={t("sourceLabel")}
          spellCheck={false}
          readOnly={!editor.isEditable}
          rows={Math.min(Math.max(source.split("\n").length, 3), 16)}
          onChange={(e) => updateAttributes({ source: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div className="jb-mermaid__preview-pane">
          <MermaidDiagram source={source} debounceMs={PREVIEW_DEBOUNCE_MS} />
        </div>
      </div>
    </NodeViewWrapper>
  );
}
