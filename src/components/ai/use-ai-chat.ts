"use client";

import { useCallback, useRef, useState } from "react";
import { parseSseStream } from "@/lib/ai/sse";
import type { AiConversationMessage, AiSource } from "@/lib/ai/types";

/**
 * AI 問答對話狀態機（I-03／I-07）。
 *
 * 封裝：訊息串維護、fetch `/api/ai/chat` 的 SSE 串流消費、停止生成（AbortController）、
 * 錯誤與重試，以及多輪對話（conversationId 續談、新對話、載入歷史）。UI 元件只讀狀態、
 * 呼叫 send/stop/retry/newConversation/loadConversation，不碰傳輸細節。
 *
 * 狀態流：idle → retrieving（送出後、收到 sources 前）→ generating（串流 delta 中）→ idle。
 * 多輪：首問無 conversationId，伺服器新建對話並經 `conversation` 事件回傳 id；後續送出
 * 帶上該 id 續談（伺服器載入歷史 + query rewrite）。切換歷史對話以 loadConversation 載入。
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
  /**
   * 觸發限流（HTTP 429，NFR-SEC-07）時的回呼，帶建議重試秒數（Retry-After）。
   * 由元件層顯示 toast 提示（I-06）；不設定則靜默（回 idle，不顯示 inline 錯誤）。
   */
  onRateLimited?: (retryAfterSeconds: number) => void;
}

export interface UseAiChat {
  messages: AiMessage[];
  status: AiChatStatus;
  error: string | null;
  /** 目前對話 id（null＝尚未開始或全新對話）。 */
  conversationId: string | null;
  /** 是否正在串流（retrieving 或 generating）。 */
  isStreaming: boolean;
  send: (question: string) => void;
  stop: () => void;
  retry: () => void;
  /** 開新對話（清空訊息與 conversationId；串流中則先中止）。 */
  newConversation: () => void;
  /** 載入既有對話歷史（切換歷史對話；串流中則先中止）。 */
  loadConversation: (detail: { id: string; messages: AiConversationMessage[] }) => void;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function useAiChat({ genericError, onRateLimited }: UseAiChatOptions): UseAiChat {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [status, setStatus] = useState<AiChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const lastQuestionRef = useRef<string | null>(null);
  const lastAssistantIdRef = useRef<string | null>(null);
  // 續談用：send 於非同步流程中讀最新 conversationId（避免閉包過期）。
  const conversationIdRef = useRef<string | null>(null);

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
          body: JSON.stringify({
            question,
            // 續談：帶上目前對話 id（首問為 null → 伺服器新建對話）。
            conversationId: conversationIdRef.current ?? undefined,
          }),
          signal: controller.signal,
        });

        // 429 有兩種：限流（RATE_LIMITED，帶 Retry-After）與每日配額用罄（QUOTA_EXCEEDED，I-09）。
        // 以錯誤碼區分：配額用罄顯示 inline 訊息（非重試提示）；限流交元件層以 toast 提示。
        if (res.status === 429) {
          let code: string | undefined;
          let message: string | undefined;
          try {
            const body = (await res.json()) as { error?: { code?: string; message?: string } };
            code = body?.error?.code;
            message = body?.error?.message;
          } catch {
            // 非 JSON 回應：視為限流處理
          }
          if (code === "QUOTA_EXCEEDED") {
            setError(message || genericError);
            setStatus("idle");
            return;
          }
          const retryAfter = Number(res.headers.get("retry-after"));
          onRateLimited?.(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60);
          setStatus("idle");
          return;
        }

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
            case "conversation":
              // 伺服器回傳（新建或續談）對話 id：記住供後續續談。
              conversationIdRef.current = evt.data.id;
              setConversationId(evt.data.id);
              break;
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
    [genericError, onRateLimited, patchAssistant],
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

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    lastQuestionRef.current = null;
    lastAssistantIdRef.current = null;
    setError(null);
    setStatus("idle");
  }, []);

  const newConversation = useCallback(() => {
    reset();
    conversationIdRef.current = null;
    setConversationId(null);
    setMessages([]);
  }, [reset]);

  const loadConversation = useCallback(
    (detail: { id: string; messages: AiConversationMessage[] }) => {
      reset();
      conversationIdRef.current = detail.id;
      setConversationId(detail.id);
      setMessages(
        detail.messages.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          sources: m.sources,
        })),
      );
    },
    [reset],
  );

  return {
    messages,
    status,
    error,
    conversationId,
    isStreaming: status !== "idle",
    send,
    stop,
    retry,
    newConversation,
    loadConversation,
  };
}
