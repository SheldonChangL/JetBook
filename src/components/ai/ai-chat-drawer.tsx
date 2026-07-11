"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowUp, Plus, Sparkles, Square } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import { AnswerContent } from "./answer-content";
import { ConversationHistory } from "./conversation-history";
import { SourceCards } from "./source-cards";
import { useAiChat, type AiMessage } from "./use-ai-chat";

/**
 * AI 問答抽屜（I-03，設計規範 §3.7）。
 *
 * 右側 420px 抽屜：訊息串（使用者右氣泡／AI 左 Markdown＋引用 chip）、串流逐字＋
 * 閃爍游標＋停止生成、狀態列（檢索中→找到 N 篇生成中）、來源卡片列、
 * 追問輸入（Enter 送出／Shift+Enter 換行／IME 防護）、錯誤 inline alert＋重試、
 * 免責 caption。入口是否顯示由 server 依 isLlmConfigured 決定（NFR-AVAIL-02），
 * 本元件只在已啟用時掛載。
 */

const MAX_INPUT_HEIGHT = 132;

export interface AiChatDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AiChatDrawer({ open, onOpenChange }: AiChatDrawerProps) {
  const t = useTranslations("ai");
  const router = useRouter();
  const toast = useToast();
  // 限流（NFR-SEC-07）：以 toast 提示已達每分鐘上限並帶重試秒數（I-06）。
  const onRateLimited = useCallback(
    (retryAfterSeconds: number) => {
      toast({
        variant: "error",
        title: t("rateLimited"),
        description: t("rateLimitedRetry", { seconds: retryAfterSeconds }),
      });
    },
    [t, toast],
  );
  const chat = useAiChat({ genericError: t("failed"), onRateLimited });
  const {
    messages,
    status,
    error,
    conversationId,
    isStreaming,
    send,
    stop,
    retry,
    newConversation,
    loadConversation,
  } = chat;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);

  // 引用跳轉（I-04，F-AI-05）：收合抽屜後導向來源頁錨點；閱讀頁載入時捲動＋高亮（G-05）。
  const closeDrawer = useCallback(() => onOpenChange(false), [onOpenChange]);
  const navigateToSource = useCallback(
    (url: string) => {
      onOpenChange(false);
      router.push(url);
    },
    [onOpenChange, router],
  );

  // 新內容時捲到底（串流逐字亦持續貼底）。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status, error]);

  // 開啟時聚焦輸入框。
  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const autoGrow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, []);

  const submit = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const value = el.value;
    if (!value.trim() || isStreaming) return;
    send(value);
    el.value = "";
    autoGrow();
  }, [autoGrow, isStreaming, send]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      // IME 組字中（含 Enter 選字）不得誤觸送出：nativeEvent.isComposing 與
      // compositionstart/end 雙重防護（definition-of-done「IME composition 檢查」）。
      if (e.key === "Enter" && !e.shiftKey) {
        if (e.nativeEvent.isComposing || composingRef.current) return;
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  const headerActions = (
    <>
      <ConversationHistory currentConversationId={conversationId} onSelect={loadConversation} />
      <IconButton
        label={t("newConversation")}
        onClick={newConversation}
        disabled={messages.length === 0 && conversationId === null}
      >
        <Plus className="size-4" />
      </IconButton>
    </>
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={t("title")} closeLabel={t("closeLabel")} headerActions={headerActions}>
        <div className="flex h-full min-h-0 flex-col">
          {/* 訊息串（串流逐字更新以 aria-live 播報） */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 ? (
              <EmptyState
                className="h-full py-0"
                icon={<Sparkles />}
                title={t("emptyTitle")}
                description={t("emptyDescription")}
              />
            ) : (
              <div className="flex flex-col gap-3.5">
                {messages.map((m) =>
                  m.role === "user" ? (
                    <div
                      key={m.id}
                      className="max-w-[85%] self-end rounded-lg rounded-br-xs bg-primary-tint px-3 py-2 text-body-ui text-fg"
                    >
                      {m.text}
                    </div>
                  ) : (
                    <AssistantMessage
                      key={m.id}
                      message={m}
                      streaming={isStreaming && m.id === lastAssistantId}
                      sourcesLabel={t("sourcesLabel")}
                      citeLabel={(n) => t("citationLabel", { n })}
                      onNavigateToSource={navigateToSource}
                      onCloseDrawer={closeDrawer}
                    />
                  ),
                )}

                {/* 狀態列：檢索中 → 找到 N 篇生成中（含停止生成） */}
                {isStreaming ? (
                  <div className="flex items-center gap-2 text-caption text-fg-tertiary">
                    <span className="inline-block size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-ai border-t-transparent" />
                    <span>
                      {status === "retrieving"
                        ? t("retrieving")
                        : (() => {
                            const count =
                              messages.find((m) => m.id === lastAssistantId)?.sources.length ?? 0;
                            return count > 0 ? t("generating", { count }) : t("generatingPlain");
                          })()}
                    </span>
                    <button
                      type="button"
                      onClick={stop}
                      className="ml-1 inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
                    >
                      <Square aria-hidden className="size-3" />
                      {t("stop")}
                    </button>
                  </div>
                ) : null}

                {/* 錯誤 inline alert + 重試 */}
                {error ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-sm border border-danger/40 bg-danger-tint px-3 py-2 text-caption text-danger"
                  >
                    <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    <div className="flex-1">
                      <p>{error}</p>
                      <button
                        type="button"
                        onClick={retry}
                        className="mt-1 font-medium underline underline-offset-2 hover:no-underline"
                      >
                        {t("retry")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* 底部輸入區 + 免責 caption */}
          <div className="shrink-0 border-t border-edge bg-base px-4 pb-2.5 pt-3">
            <div className="flex items-end gap-2 rounded-md border border-edge-strong bg-base px-3 py-2 focus-within:border-ai focus-within:ring-3 focus-within:ring-ai-tint">
              <textarea
                ref={inputRef}
                rows={1}
                onInput={autoGrow}
                onKeyDown={onKeyDown}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                placeholder={t("inputPlaceholder")}
                aria-label={t("inputAriaLabel")}
                className="max-h-33 flex-1 resize-none bg-transparent text-body-ui leading-[22px] text-fg outline-none placeholder:text-fg-disabled"
              />
              {isStreaming ? (
                <button
                  type="button"
                  onClick={stop}
                  aria-label={t("stop")}
                  title={t("stop")}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-hover text-fg-secondary transition-colors hover:text-fg"
                >
                  <Square aria-hidden className="size-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  aria-label={t("send")}
                  title={t("send")}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-ai text-white transition-[filter] hover:brightness-110"
                >
                  <ArrowUp aria-hidden className="size-4" />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-caption text-fg-tertiary">{t("inputHint")}</p>
            <p className="mt-1.5 text-center text-caption text-fg-tertiary">{t("disclaimer")}</p>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function AssistantMessage({
  message,
  streaming,
  sourcesLabel,
  citeLabel,
  onNavigateToSource,
  onCloseDrawer,
}: {
  message: AiMessage;
  streaming: boolean;
  sourcesLabel: string;
  citeLabel: (n: number) => string;
  /** 點內文引用 [n]：導向對應來源頁錨點（I-04，F-AI-05）。 */
  onNavigateToSource: (url: string) => void;
  /** 點來源卡片（<Link> 導頁）前收合抽屜。 */
  onCloseDrawer: () => void;
}) {
  // 點內文引用 [n] → 導向對應來源頁的錨點（收合抽屜由 onNavigateToSource 處理）。
  // 串流中 sources 尚未送達時（找不到對應 n）不動作，待來源就緒再跳轉。
  const onCite = useCallback(
    (n: number) => {
      const url = message.sources.find((s) => s.n === n)?.url;
      if (url) onNavigateToSource(url);
    },
    [message.sources, onNavigateToSource],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="text-body-ui leading-6 text-fg">
        <AnswerContent text={message.text} onCite={onCite} citeLabel={citeLabel} />
        {streaming ? (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-ai align-middle motion-safe:animate-pulse"
          />
        ) : null}
      </div>
      <SourceCards label={sourcesLabel} sources={message.sources} onSelect={onCloseDrawer} />
    </div>
  );
}
