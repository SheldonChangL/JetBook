"use client";

import { Download, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { attachmentFileUrl, formatFileSize } from "@/components/editor/attachment/attachment-utils";

/**
 * 附件卡片（D-08，F-EDIT-10）：檔名／大小／下載連結。
 * 編輯器節點視圖與閱讀渲染共用同一元件，確保「編輯與閱讀一致」。
 * 下載走 /api/files/<id>（下載 API 於伺服端驗 page.read 權限，M-02）。
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
  const href = attachmentFileUrl(attachmentId);
  const size = formatFileSize(sizeBytes);
  const displayName = fileName || t("unnamed");

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
