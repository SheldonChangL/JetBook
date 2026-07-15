"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 附件線上預覽狀態探測（M4-11 PDF／M4-12 Office 衍生 PDF）。
 * 預覽 Modal（AttachmentPreviewButton）與內嵌文件檢視（InlineDocument）共用同一邏輯：
 * GET 探測預覽端點 → 200 ready（iframe 可載入）／202 pending（Office 轉檔中，輪詢）／其他 unavailable。
 * `active` 為 false 時不探測（如 Modal 未開啟）；轉 true 即重新自 probing 起算。
 */

/** Office 轉檔輪詢間隔／上限（202 → 3s 一次，最多 2 分鐘後視為失敗提示下載）。 */
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 40;

export type AttachmentPreviewState = "probing" | "ready" | "pending" | "unavailable";

export function useAttachmentPreview(previewUrl: string, active: boolean): AttachmentPreviewState {
  const [state, setState] = useState<AttachmentPreviewState>("probing");

  const probeStatus = useCallback(async (): Promise<AttachmentPreviewState> => {
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

  // active 期間探測；202 每 POLL_INTERVAL_MS 重測（active 轉 false 即停）。輪詢以遞迴
  // setTimeout 驅動，不依賴 state 變化觸發（連續 202 setState 同值會被 React bail out）。
  useEffect(() => {
    if (!active) return;
    setState("probing");
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
  }, [active, probeStatus]);

  return state;
}
