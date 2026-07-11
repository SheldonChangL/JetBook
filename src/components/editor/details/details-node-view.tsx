"use client";

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";

/**
 * 摺疊區塊節點視圖（D-12，編輯端）：
 * - 標題列：展開/收合切換鈕（chevron）+ 摘要標題輸入框（原生 input，IME 友善）。
 * - open 為作者設定的預設狀態，寫入文件（updateAttributes）；收合時以 data-open + CSS 隱藏內文。
 * - 內文由 NodeViewContent 承載（可放段落/清單等 block）。
 */
export function DetailsNodeView({ editor, node, updateAttributes }: NodeViewProps) {
  const t = useTranslations("editor.details");
  const open = node.attrs.open !== false;
  const summary = typeof node.attrs.summary === "string" ? node.attrs.summary : "";

  return (
    <NodeViewWrapper className="jb-details" data-open={open ? "true" : "false"}>
      <div className="jb-details__header" contentEditable={false}>
        <button
          type="button"
          className="jb-details__toggle"
          aria-expanded={open}
          aria-label={t("toggle")}
          onClick={() => updateAttributes({ open: !open })}
        >
          <ChevronRight className="jb-details__chevron size-4" aria-hidden />
        </button>
        <input
          className="jb-details__summary"
          value={summary}
          placeholder={t("summaryPlaceholder")}
          aria-label={t("summaryPlaceholder")}
          onChange={(e) => updateAttributes({ summary: e.target.value })}
          readOnly={!editor.isEditable}
        />
      </div>
      <NodeViewContent className="jb-details__body" />
    </NodeViewWrapper>
  );
}
