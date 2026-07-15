"use client";

import { Download, Loader2, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  attachmentFileUrl,
  attachmentPreviewUrl,
  formatFileSize,
} from "@/components/editor/attachment/attachment-utils";
import { useAttachmentPreview } from "./use-attachment-preview";

/**
 * 內嵌文件檢視（issue #241）：可線上檢視的附件（PDF／啟用轉檔的 Office）直接把內容
 * 內嵌在頁面上（固定高度、可捲動 iframe），頂列顯示檔名＋下載（下載為次要）。
 * 編輯器 node view 與閱讀渲染共用（ContentAttachment 依型別分流至此或卡片）。
 *
 * 安全性同 AttachmentPreviewButton：iframe 不加 sandbox（Chromium 內建 PDF 檢視器在
 * sandboxed iframe 不渲染），預覽端點僅回 application/pdf inline＋nosniff，且下載/預覽
 * 端點皆於伺服端驗 page.read 權限。轉檔中顯示 loading、失敗回退為可下載提示。
 */
export function InlineDocument({
  attachmentId,
  fileName,
  sizeBytes,
}: {
  attachmentId: string;
  fileName: string;
  sizeBytes: number;
}) {
  const t = useTranslations("content.attachment");
  const previewUrl = attachmentPreviewUrl(attachmentId);
  const state = useAttachmentPreview(previewUrl, true);
  const displayName = fileName || t("unnamed");
  const size = formatFileSize(sizeBytes);

  return (
    <div className="content-document" data-type="attachment">
      <div className="content-document__bar">
        <Paperclip aria-hidden className="content-document__icon" />
        <span className="content-document__name">{displayName}</span>
        {size ? <span className="content-document__size">{size}</span> : null}
        <a
          href={attachmentFileUrl(attachmentId)}
          download={fileName || undefined}
          className="content-document__download"
          aria-label={t("downloadAria", { fileName: displayName })}
        >
          <Download aria-hidden className="size-4" />
          <span>{t("download")}</span>
        </a>
      </div>
      {state === "ready" ? (
        <iframe
          src={previewUrl}
          title={t("previewFrameTitle", { fileName: displayName })}
          className="content-document__frame"
        />
      ) : state === "probing" || state === "pending" ? (
        <div className="content-document__status">
          <Loader2 aria-hidden className="size-6 animate-spin" />
          <p>{t("previewConverting")}</p>
        </div>
      ) : (
        <div className="content-document__status">
          <p>{t("previewUnavailable")}</p>
        </div>
      )}
    </div>
  );
}
