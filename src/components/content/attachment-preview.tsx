"use client";

import { useEffect, useState } from "react";
import { Download, Eye, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal, ModalContent } from "@/components/ui/modal";
import {
  attachmentFileUrl,
  attachmentPreviewUrl,
} from "@/components/editor/attachment/attachment-utils";
import { useAttachmentPreview } from "./use-attachment-preview";

/**
 * Office 附件預覽是否啟用（M4-12）：root layout 依 env 在 <body data-office-preview>
 * 標記；client 於 mount 後讀取（SSR 階段回 false，避免 hydration 不一致）。
 */
export function useOfficePreviewEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(document.body.dataset.officePreview === "1");
  }, []);
  return enabled;
}

/**
 * 附件預覽鈕＋全螢幕 Modal（M4-11 PDF／M4-12 Office 衍生 PDF）。附件卡片與搜尋結果共用。
 * 開啟時先 HEAD 探測預覽端點：200 → iframe 載入；202 → Office 轉檔中（輪詢）；
 * 其他 → 顯示「無法預覽，請下載」。
 * iframe 不加 sandbox：Chromium 的內建 PDF 檢視器在 sandboxed iframe 中不渲染（顯示空白）；
 * 安全性由伺服端保證——preview 端點僅回 PDF 內容 inline（Content-Type 固定 application/pdf
 * ＋nosniff），等同在分頁直接開啟 PDF 的風險面。
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
  const previewUrl = attachmentPreviewUrl(attachmentId);
  // 探測只在 Modal 開啟時進行（active=open）；共用 hook（與內嵌文件檢視同一邏輯）。
  const state = useAttachmentPreview(previewUrl, open);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
  };

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
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
          {open && state === "ready" ? (
            <iframe
              src={previewUrl}
              title={t("previewFrameTitle", { fileName: displayName })}
              className="h-[72vh] w-full rounded-md border border-edge bg-sunken"
            />
          ) : null}
          {open && (state === "probing" || state === "pending") ? (
            <div className="flex h-[72vh] w-full flex-col items-center justify-center gap-3 rounded-md border border-edge bg-sunken text-fg-secondary">
              <Loader2 aria-hidden className="size-6 animate-spin" />
              <p className="text-body-ui">{t("previewConverting")}</p>
            </div>
          ) : null}
          {open && state === "unavailable" ? (
            <div className="flex h-[40vh] w-full flex-col items-center justify-center gap-3 rounded-md border border-edge bg-sunken text-fg-secondary">
              <p className="text-body-ui">{t("previewUnavailable")}</p>
            </div>
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
