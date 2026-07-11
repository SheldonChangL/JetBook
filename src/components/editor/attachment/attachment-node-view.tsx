"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { ContentAttachment } from "@/components/content/content-attachment";

/**
 * 編輯器內的附件節點視圖（D-08）：以與閱讀端相同的 ContentAttachment 卡片呈現，
 * 確保編輯與閱讀一致。節點為 atom（無可編輯內文），整卡可拖曳搬移。
 * 下載連結於編輯器內同樣可用（下載 API 驗權限）。
 */
export function AttachmentNodeView({ node, selected }: NodeViewProps) {
  const attachmentId = typeof node.attrs.attachmentId === "string" ? node.attrs.attachmentId : "";
  const fileName = typeof node.attrs.fileName === "string" ? node.attrs.fileName : "";
  const sizeBytes = typeof node.attrs.sizeBytes === "number" ? node.attrs.sizeBytes : 0;

  return (
    <NodeViewWrapper
      as="div"
      className={cn("content-attachment-wrapper", selected && "is-selected")}
      data-drag-handle
    >
      <ContentAttachment attachmentId={attachmentId} fileName={fileName} sizeBytes={sizeBytes} />
    </NodeViewWrapper>
  );
}
