"use client";

import { useState } from "react";
import { Download, Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal, ModalContent } from "@/components/ui/modal";
import {
  attachmentFileUrl,
  attachmentPreviewUrl,
} from "@/components/editor/attachment/attachment-utils";

/**
 * PDF 附件預覽鈕＋全螢幕 Modal（M4-11，issue #215）。附件卡片與搜尋結果共用。
 * iframe 不加 sandbox：Chromium 的內建 PDF 檢視器在 sandboxed iframe 中不渲染（顯示空白）；
 * 安全性由伺服端保證——preview 端點僅對副檔名＋MIME 皆為 PDF 的附件回 inline
 * （Content-Type 固定 application/pdf＋nosniff），等同在分頁直接開啟 PDF 的風險面。
 */
export function AttachmentPreviewButton({
  attachmentId,
  fileName,
}: {
  attachmentId: string;
  fileName: string;
}) {
  const t = useTranslations("content.attachment");
  const [open, setOpen] = useState(false);
  const displayName = fileName || t("unnamed");

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="content-attachment__download"
        aria-label={t("previewAria", { fileName: displayName })}
      >
        <Eye aria-hidden className="size-4" />
        <span>{t("preview")}</span>
      </button>
      <ModalContent
        title={displayName}
        closeLabel={t("previewClose")}
        className="max-w-[min(1100px,calc(100vw-32px))]"
      >
        <div className="flex flex-col gap-3">
          {open ? (
            <iframe
              src={attachmentPreviewUrl(attachmentId)}
              title={t("previewFrameTitle", { fileName: displayName })}
              className="h-[72vh] w-full rounded-md border border-edge bg-sunken"
            />
          ) : null}
          <a
            href={attachmentFileUrl(attachmentId)}
            download={fileName || undefined}
            className="inline-flex items-center gap-1 self-end text-body-ui text-fg-secondary hover:text-fg hover:underline"
          >
            <Download aria-hidden className="size-4" />
            <span>{t("download")}</span>
          </a>
        </div>
      </ModalContent>
    </Modal>
  );
}
