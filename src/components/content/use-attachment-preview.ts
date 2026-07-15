"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 附件線上預覽狀態探測（M4-11 PDF／M4-12 Office 衍生 PDF）。
 * 預覽 Modal（AttachmentPreviewButton）與內嵌文件檢視（InlineDocument）共用同一邏輯：
 * GET 探測預覽端點 → 200 ready（iframe 可載入）／202 pending（Office 轉檔中，輪詢）／其他 unavailable。
 * `active` 為 false 時不探測（如 Modal 未開啟）。
 *
 * `skipProbing`（PDF 用）：PDF 為原生 inline、無後端轉檔，恆為 ready——直接以 ready 起始並
 * 跳過探測，避免「探測 GET ＋ iframe 載入」的雙重請求（頁面內嵌多個 PDF 時尤其明顯）。
 *
 * 輸入（previewUrl／active／skipProbing）改變時於「渲染期」同步重設狀態（React 官方
 * Resetting-state-during-render 模式），避免換附件或 Modal 重開時殘留上一次畫面的閃爍，
 * 也讓 NodeView 被重用於不同附件時狀態正確。
 */

/** Office 轉檔輪詢間隔／上限（202 → 3s 一次，最多 2 分鐘後視為失敗提示下載）。 */
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 40;

export type AttachmentPreviewState = "probing" | "ready" | "pending" | "unavailable";

export function useAttachmentPreview(
  previewUrl: string,
  active: boolean,
  skipProbing = false,
): AttachmentPreviewState {
  const initial: AttachmentPreviewState = skipProbing ? "ready" : "probing";
  const [state, setState] = useState<AttachmentPreviewState>(initial);

  // 渲染期重設：輸入改變即同步回初始狀態（`|` 分隔避免值黏連誤判）。
  const key = `${previewUrl}|${active}|${skipProbing}`;
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setState(initial);
  }

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

  // active 期間探測（skipProbing＝PDF 免探測）；202 每 POLL_INTERVAL_MS 重測（active 轉 false 即停）。
  // 輪詢以遞迴 setTimeout 驅動，不依賴 state 變化觸發（連續 202 setState 同值會被 React bail out）。
  // 起始狀態已於渲染期重設，此處不再 setState("probing")。
  useEffect(() => {
    if (!active || skipProbing) return;
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
  }, [active, skipProbing, probeStatus]);

  return state;
}
