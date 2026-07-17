"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, History } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { AiConversationDetail, AiConversationSummary } from "@/lib/ai/types";

/**
 * AI 對話歷史下拉（I-07，F-AI-07）。僅本人可見：開啟時拉取本人對話列表
 * （GET /api/ai/conversations），點選載入該對話歷史（GET /api/ai/conversations/[id]）
 * 後交由 onSelect 切換。當前對話以勾選標示。
 */
export interface ConversationHistoryProps {
  currentConversationId: string | null;
  onSelect: (detail: AiConversationDetail) => void;
}

export function ConversationHistory({ currentConversationId, onSelect }: ConversationHistoryProps) {
  const t = useTranslations("ai");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AiConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/ai/conversations", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error("list failed");
      const body = (await res.json()) as { conversations: AiConversationSummary[] };
      setItems(body.conversations);
    } catch {
      setError(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) void loadList();
    },
    [loadList],
  );

  const selectConversation = useCallback(
    async (id: string) => {
      setSelectingId(id);
      setError(false);
      try {
        const res = await fetch(`/api/ai/conversations/${id}`, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error("detail failed");
        const detail = (await res.json()) as AiConversationDetail;
        onSelect(detail);
        setOpen(false);
      } catch {
        setError(true);
      } finally {
        setSelectingId(null);
      }
    },
    [onSelect],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={t("history")}
        title={t("history")}
        className="inline-flex size-8 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
      >
        <History className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="archive-ai-history w-80 max-w-[calc(100vw-32px)] p-1.5">
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <p className="px-2.5 py-6 text-center text-caption text-fg-tertiary">
              {t("historyLoading")}
            </p>
          ) : error ? (
            <p className="px-2.5 py-6 text-center text-caption text-danger">{t("historyError")}</p>
          ) : items.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-caption text-fg-tertiary">
              {t("historyEmpty")}
            </p>
          ) : (
            <ul className="flex flex-col">
              {items.map((c) => {
                const isCurrent = c.id === currentConversationId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => void selectConversation(c.id)}
                      disabled={selectingId !== null}
                      className={cn(
                        "archive-ai-history-item flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-body-ui text-fg transition-colors hover:bg-hover disabled:opacity-60",
                        isCurrent && "bg-hover",
                      )}
                    >
                      <span className="flex-1 truncate">
                        {c.title.trim() || t("untitledConversation")}
                      </span>
                      {isCurrent ? (
                        <Check aria-hidden className="size-3.5 shrink-0 text-ai" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
