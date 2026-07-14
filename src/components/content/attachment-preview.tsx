"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Eye, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal, ModalContent } from "@/components/ui/modal";
import {
  attachmentFileUrl,
  attachmentPreviewUrl,
} from "@/components/editor/attachment/attachment-utils";

/** Office 轉檔輪詢間隔／上限（202 → 3s 一次，最多 2 分鐘後視為失敗提示下載）。 */
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 40;

type PreviewState = "probing" | "ready" | "pending" | "unavailable";

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
  const [state, setState] = useState<PreviewState>("probing");
  const displayName = fileName || t("unnamed");
  const previewUrl = attachmentPreviewUrl(attachmentId);

  const probeStatus = useCallback(async (): Promise<PreviewState> => {
    try {
      // 用 GET 而非 HEAD：202/錯誤回應帶 JSON body，HEAD 帶 body 會被 Chrome 以
      // 協定違規中止（ERR_ABORTED）。拿到 status 後立即取消 body，不實際下載 PDF。
      const res = await fetch(previewUrl);
      void res.body?.cancel().catch(() => undefined);
      if (res.status === 200) return "ready";
      if (res.status === 202) return "pending";
      return "unavailable";
    } catch {
      return "unavailable";
    }
  }, [previewUrl]);

  // 開啟時探測；202 每 POLL_INTERVAL_MS 重測（關閉即停）。輪詢以遞迴 setTimeout 驅動、
  // 不依賴 state 變化觸發（連續 202 時 setState 同值會被 React bail out，effect 不重跑）。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const run = async () => {
      const status = await probeStatus();
      if (cancelled) return;
      if (status === "pending" && tries < POLL_MAX_TRIES) {
        tries += 1;
        setState("pending");
        timer = setTimeout(() => void run(), POLL_INTERVAL_MS);
        return;
      }
      setState(status === "pending" ? "unavailable" : status);
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, probeStatus]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setState("probing");
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
