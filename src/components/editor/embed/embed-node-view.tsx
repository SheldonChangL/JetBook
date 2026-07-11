"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContentEmbed } from "@/components/content/content-embed";
import { isEmbedUrlAllowed, normalizeEmbedUrl } from "@/lib/content/embed";

/**
 * Embed 嵌入節點視圖（D-14，編輯端）：
 * - 上：URL 輸入框（原生 input，IME 友善；停止鍵盤事件冒泡，避免 ProseMirror 攔截）。
 * - 下：預覽——URL 落在白名單內即 iframe 嵌入，否則退化為連結卡片（與閱讀端共用 ContentEmbed）。
 * - 白名單自 `editor.storage.embed.allowedDomains` 於渲染當下讀取（由 PageEditor 依 env 填入）。
 * - atom 節點：整區 contentEditable=false，input 自行管理輸入；拖曳把手可搬移區塊。
 */
export function EmbedNodeView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const t = useTranslations("editor.embed");
  const url = normalizeEmbedUrl(node.attrs.url);
  const allowedDomains = editor.storage.embed?.allowedDomains ?? [];
  const allowed = isEmbedUrlAllowed(url, allowedDomains);

  return (
    <NodeViewWrapper
      as="div"
      className={cn("jb-embed jb-embed--edit", selected && "is-selected")}
      data-embed=""
    >
      <div className="jb-embed__editor" contentEditable={false}>
        <div className="jb-embed__header">
          {editor.isEditable ? (
            <span
              className="jb-embed__drag"
              data-drag-handle
              aria-hidden
              contentEditable={false}
            >
              <GripVertical className="size-4" />
            </span>
          ) : null}
          <span className="jb-embed__label">{t("urlLabel")}</span>
          {url ? (
            <span className="jb-embed__status" data-allowed={allowed ? "true" : "false"}>
              {allowed ? t("statusEmbedded") : t("statusFallbackCard")}
            </span>
          ) : null}
        </div>
        <input
          type="url"
          inputMode="url"
          className="jb-embed__input"
          value={url}
          placeholder={t("urlPlaceholder")}
          aria-label={t("urlLabel")}
          spellCheck={false}
          readOnly={!editor.isEditable}
          onChange={(e) => updateAttributes({ url: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {url ? (
          <div className="jb-embed__preview-pane">
            <ContentEmbed url={url} allowed={allowed} />
          </div>
        ) : (
          <p className="jb-embed__hint">{t("emptyHint")}</p>
        )}
      </div>
    </NodeViewWrapper>
  );
}
