"use client";

import { useCallback, useRef, useState } from "react";
import { parseSseStream } from "@/lib/ai/sse";
import type { AiSource } from "@/lib/ai/types";

/**
 * AI 問答對話狀態機（I-03）。
 *
 * 封裝：訊息串維護、fetch `/api/ai/chat` 的 SSE 串流消費、停止生成（AbortController）、
 * 錯誤與重試。UI 元件只讀狀態、呼叫 send/stop/retry，不碰傳輸細節。
 *
 * 狀態流：idle → retrieving（送出後、收到 sources 前）→ generating（串流 delta 中）→ idle。
 * 停止：abort fetch，保留已生成的部分文字，回 idle（非錯誤）。
 * 錯誤：HTTP 非 2xx 或 SSE error 事件 → 記錄可重試錯誤，回 idle。
 */

export type AiChatStatus = "idle" | "retrieving" | "generating";

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources: AiSource[];
}

export interface UseAiChatOptions {
  /** HTTP 非 2xx 或未知錯誤時顯示的訊息（經 i18n）。 */
  genericError: string;
}

export interface UseAiChat {
  messages: AiMessage[];
  status: AiChatStatus;
  error: string | null;
  /** 是否正在串流（retrieving 或 generating）。 */
  isStreaming: boolean;
  send: (question: string) => void;
  stop: () => void;
  retry: () => void;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function useAiChat({ genericError }: UseAiChatOptions): UseAiChat {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [status, setStatus] = useState<AiChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const lastQuestionRef = useRef<string | null>(null);
  const lastAssistantIdRef = useRef<string | null>(null);

  const patchAssistant = useCallback(
    (id: string, patch: (m: AiMessage) => AiMessage) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? patch(m) : m)));
    },
    [],
  );

  const runStream = useCallback(
    async (question: string, assistantId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setStatus("retrieving");

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question }),
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
          setStatus("idle");
          return;
        }

        for await (const evt of parseSseStream(res.body)) {
          switch (evt.event) {
            case "sources":
              patchAssistant(assistantId, (m) => ({ ...m, sources: evt.data }));
              setStatus("generating");
              break;
            case "delta":
              patchAssistant(assistantId, (m) => ({ ...m, text: m.text + (evt.data.text ?? "") }));
              break;
            case "error":
              setError(evt.data.message || genericError);
              break;
            case "done":
              break;
          }
        }
        setStatus("idle");
      } catch (err) {
        // 使用者按「停止生成」→ abort：保留部分文字，非錯誤。
        if (controller.signal.aborted) {
          setStatus("idle");
          return;
        }
        // 網路層失敗（斷線、逾時等）：顯示通用可重試錯誤。
        void err;
        setError(genericError);
        setStatus("idle");
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [genericError, patchAssistant],
  );

  const send = useCallback(
    (raw: string) => {
      const question = raw.trim();
      if (!question || abortRef.current) return;

      const assistantId = nextId("a");
      lastQuestionRef.current = question;
      lastAssistantIdRef.current = assistantId;

      setMessages((prev) => [
        ...prev,
        { id: nextId("u"), role: "user", text: question, sources: [] },
        { id: assistantId, role: "assistant", text: "", sources: [] },
      ]);
      void runStream(question, assistantId);
    },
    [runStream],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    const question = lastQuestionRef.current;
    const assistantId = lastAssistantIdRef.current;
    if (!question || !assistantId || abortRef.current) return;
    // 重置上一則助理訊息後重跑（沿用同一氣泡，不重複使用者提問）。
    patchAssistant(assistantId, (m) => ({ ...m, text: "", sources: [] }));
    void runStream(question, assistantId);
  }, [patchAssistant, runStream]);

  return {
    messages,
    status,
    error,
    isStreaming: status !== "idle",
    send,
    stop,
    retry,
  };
}
