"use client";

import { useCallback, useRef, useState } from "react";
import { parseSseStream } from "@/lib/ai/sse";
import type { AssistMode } from "@/lib/ai/assist-modes";

/**
 * 編輯器寫作輔助的串流狀態機（I-08）。
 *
 * 封裝：fetch `/api/ai/assist` 的 SSE 消費、累積結果文字、停止生成（AbortController）、
 * 錯誤處理。UI 只讀狀態、呼叫 run/stop/reset，不碰傳輸細節。結果只放在此狀態中，
 * 是否套用到文件由使用者於面板決定（永不直接覆寫原文，F-AI-08）。
 *
 * 狀態流：idle → streaming（送出後串流 delta 中）→ done（收到 done 或使用者停止且已有部分結果）。
 * 錯誤：HTTP 非 2xx 或 SSE error 事件 → error。
 */

export type AssistStatus = "idle" | "streaming" | "done" | "error";

export interface UseAiAssistOptions {
  pageId: string;
  /** HTTP 非 2xx 或未知錯誤時顯示的訊息（經 i18n）。 */
  genericError: string;
}

export interface UseAiAssist {
  status: AssistStatus;
  /** 目前累積的輔助結果文字。 */
  result: string;
  /** 進行中的模式（供面板標題顯示）。 */
  mode: AssistMode | null;
  error: string | null;
  isStreaming: boolean;
  run: (mode: AssistMode, text: string) => void;
  stop: () => void;
  reset: () => void;
}

export function useAiAssist({ pageId, genericError }: UseAiAssistOptions): UseAiAssist {
  const [status, setStatus] = useState<AssistStatus>("idle");
  const [result, setResult] = useState("");
  const [mode, setMode] = useState<AssistMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // 累積結果放 ref，避免每個 delta 都因 state 閉包過期而遺漏（同時同步入 state 觸發渲染）。
  const resultRef = useRef("");

  const run = useCallback(
    (nextMode: AssistMode, text: string) => {
      // 若有進行中的請求先中止，開新的一輪。
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      resultRef.current = "";
      setResult("");
      setError(null);
      setMode(nextMode);
      setStatus("streaming");

      void (async () => {
        try {
          const res = await fetch("/api/ai/assist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: nextMode, text, pageId }),
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            let message = genericError;
            try {
              const body = (await res.json()) as { error?: { message?: string } };
              if (body?.error?.message) message = body.error.message;
            } catch {
              // 非 JSON 回應：沿用通用錯誤訊息
            }
            setError(message);
            setStatus("error");
            return;
          }

          for await (const evt of parseSseStream(res.body)) {
            switch (evt.event) {
              case "delta":
                resultRef.current += evt.data.text ?? "";
                setResult(resultRef.current);
                break;
              case "error":
                setError(evt.data.message || genericError);
                setStatus("error");
                return;
              case "done":
              case "sources":
                break;
            }
          }
          setStatus("done");
        } catch (err) {
          // 使用者按「停止」→ abort：保留已生成部分，非錯誤（有結果轉 done，否則回 idle）。
          if (controller.signal.aborted) {
            setStatus(resultRef.current ? "done" : "idle");
            return;
          }
          void err;
          setError(genericError);
          setStatus("error");
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      })();
    },
    [pageId, genericError],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    resultRef.current = "";
    setResult("");
    setError(null);
    setMode(null);
    setStatus("idle");
  }, []);

  return {
    status,
    result,
    mode,
    error,
    isStreaming: status === "streaming",
    run,
    stop,
    reset,
  };
}
