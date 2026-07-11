"use client";

import Link from "next/link";
import { BookText } from "lucide-react";
import type { AiSource } from "@/lib/ai/types";

/**
 * 引用來源卡片列（I-03，設計規範 §3.7）。
 * 橫向可捲動；每張卡片：編號 chip + 標題 + 所屬 space/章節 + 兩行摘錄，
 * 點擊導向該頁面錨點（url 由 answer.buildSources 產生，含 `#<slug>`，I-04 引用跳轉）。
 * 保留 <Link> 語意（可鍵盤操作、新分頁開啟）；`onSelect` 供呼叫端在點擊時收合抽屜。
 */
export interface SourceCardsProps {
  label: string;
  sources: AiSource[];
  /** 點擊卡片時觸發（導頁前收合 AI 抽屜，讓使用者看見目標頁面）。 */
  onSelect?: () => void;
}

export function SourceCards({ label, sources, onSelect }: SourceCardsProps) {
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-caption font-semibold tracking-wide text-fg-tertiary">
        <BookText aria-hidden className="size-3.5" />
        <span>{label}</span>
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1.5">
        {sources.map((s) => (
          <Link
            key={s.n}
            href={s.url}
            onClick={onSelect}
            className="flex w-61 shrink-0 flex-col rounded-sm border border-edge bg-raised p-3 text-left transition-colors hover:border-primary hover:shadow-sm"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-xs bg-ai-tint text-[10px] font-semibold text-ai"
              >
                {s.n}
              </span>
              <span className="truncate text-caption font-semibold text-fg">{s.title}</span>
            </span>
            {s.headingPath ? (
              <span className="mt-1 truncate text-caption text-fg-tertiary">{s.headingPath}</span>
            ) : null}
            <span className="mt-1.5 line-clamp-2 text-caption leading-[18px] text-fg-secondary">
              {s.snippet}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
