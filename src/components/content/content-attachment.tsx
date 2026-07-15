"use client";

import { Download, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  attachmentFileUrl,
  formatFileSize,
  isOfficePreviewCandidate,
  isPreviewableAttachment,
} from "@/components/editor/attachment/attachment-utils";
import { useOfficePreviewEnabled } from "@/components/content/attachment-preview";
import { InlineDocument } from "@/components/content/inline-document";

/**
 * 附件呈現（D-08，F-EDIT-10；內嵌檢視 issue #241）。編輯器節點視圖與閱讀渲染共用同一
 * 元件，確保「編輯與閱讀一致」。下載走 /api/files/<id>（下載 API 於伺服端驗 page.read 權限，M-02）。
 * - 可線上檢視者（PDF；啟用轉檔時的 Office）→ 內容直接內嵌（InlineDocument）。
 * - 其餘型別（zip 等）→ 檔名／大小／下載卡片。圖片為獨立 image 節點，不走此處。
 */
export function ContentAttachment({
  attachmentId,
  fileName,
  sizeBytes,
}: {
  attachmentId: string;
  fileName: string;
  sizeBytes: number;
}) {
  const t = useTranslations("content.attachment");
  const officePreviewEnabled = useOfficePreviewEnabled();
  const href = attachmentFileUrl(attachmentId);
  const size = formatFileSize(sizeBytes);
  const displayName = fileName || t("unnamed");
  const canPreview =
    isPreviewableAttachment(fileName) ||
    (officePreviewEnabled && isOfficePreviewCandidate(fileName));

  // 可檢視型別 → 內嵌文件檢視（內容直接顯示）；其餘 → 卡片。
  if (canPreview) {
    return <InlineDocument attachmentId={attachmentId} fileName={fileName} sizeBytes={sizeBytes} />;
  }

  return (
    <div className="content-attachment" data-type="attachment">
      <Paperclip aria-hidden className="content-attachment__icon" />
      <span className="content-attachment__meta">
        <span className="content-attachment__name">{displayName}</span>
        {size ? <span className="content-attachment__size">{size}</span> : null}
      </span>
      <a
        href={href}
        download={fileName || undefined}
        className="content-attachment__download"
        aria-label={t("downloadAria", { fileName: displayName })}
      >
        <Download aria-hidden className="size-4" />
        <span>{t("download")}</span>
      </a>
    </div>
  );
}
