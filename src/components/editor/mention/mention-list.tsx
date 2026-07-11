"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AtSign, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

/** suggestion 候選項：`id`+`label` 會成為節點 attrs；`secondary` 僅供顯示（不入 attrs）。 */
export interface MentionItem {
  id: string;
  label: string;
  secondary?: string;
}

export interface MentionListHandle {
  /** 交給 suggestion plugin 的鍵盤處理：上下選擇、Enter 插入。回傳是否已消化事件。 */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface MentionListProps {
  items: MentionItem[];
  command: (item: MentionItem) => void;
  /** member＝@成員；page＝頁面連結。決定 icon 與空狀態文案。 */
  kind: "member" | "page";
}

/**
 * @mention／頁面連結 suggestion 浮動面板（D-11）。
 * 全鍵盤操作（↑↓＋Enter）；定位與掛載由 suggestion plugin 的 managed mount 處理。
 * IME 選字中的鍵盤事件由 extension 的 onKeyDown 過濾（此處不處理 composition）。
 */
export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  function MentionList({ items, command, kind }, ref) {
    const t = useTranslations("editor.mention");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event) => {
        if (items.length === 0) return false;
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selectedIndex];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    const Icon = kind === "member" ? AtSign : FileText;

    return (
      <div
        role="listbox"
        aria-label={t(kind === "member" ? "membersLabel" : "pagesLabel")}
        className="max-h-[300px] w-72 overflow-y-auto rounded-md border border-edge bg-raised p-1 shadow-md"
      >
        {items.length === 0 ? (
          <div className="px-2 py-2 text-body-ui text-fg-tertiary">
            {t(kind === "member" ? "membersEmpty" : "pagesEmpty")}
          </div>
        ) : (
          items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left",
                index === selectedIndex && "bg-hover",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => command(item)}
            >
              <Icon className="size-4 shrink-0 text-fg-secondary" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body-ui text-fg">{item.label}</span>
                {item.secondary ? (
                  <span className="truncate text-caption text-fg-tertiary">{item.secondary}</span>
                ) : null}
              </span>
            </button>
          ))
        )}
      </div>
    );
  },
);
