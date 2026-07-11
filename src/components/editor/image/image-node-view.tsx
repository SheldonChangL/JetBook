"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * 編輯器內的圖片節點視圖（D-07）：圖片 + 可編輯圖說（alt）。
 * alt 同時作為無障礙替代文字與閱讀端 figcaption 圖說；尺寸吸附至內容欄寬
 * （max-width 100%，樣式見 globals.css .content-image）。
 */
export function ImageNodeView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const t = useTranslations("editor.image");
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";

  return (
    <NodeViewWrapper
      as="figure"
      className={cn("content-image-figure", selected && "is-selected")}
      data-drag-handle
    >
      {/* 使用者上傳圖片經 /api/files 動態提供，不走 next/image 最佳化 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="content-image" draggable={false} />
      {editor.isEditable ? (
        <input
          type="text"
          value={alt}
          onChange={(event) => updateAttributes({ alt: event.target.value })}
          placeholder={t("captionPlaceholder")}
          aria-label={t("captionLabel")}
          className="content-image-caption-input"
        />
      ) : alt ? (
        <figcaption className="content-image-caption">{alt}</figcaption>
      ) : null}
    </NodeViewWrapper>
  );
}
