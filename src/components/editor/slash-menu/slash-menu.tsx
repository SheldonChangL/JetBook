"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SLASH_MENU_GROUP_ORDER, type SlashMenuItem } from "./items";

export interface SlashMenuHandle {
  /** 交給 suggestion plugin 的鍵盤處理：上下選擇、Enter 插入。回傳是否已消化事件。 */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface SlashMenuProps {
  items: SlashMenuItem[];
  command: (item: SlashMenuItem) => void;
}

/**
 * Slash 選單浮動面板（D-03，F-EDIT-02）：寬 320px、最高 400px 可捲動，
 * 依分組（基本／進階／AI）渲染 icon＋名稱＋說明；全鍵盤操作（↑↓＋Enter）。
 * 定位與掛載由 suggestion plugin 的 managed mount 處理。
 */
export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(
  function SlashMenu({ items, command }, ref) {
    const t = useTranslations("editor.slash");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    // 依分組順序攤平（鍵盤索引與渲染順序一致）
    const grouped = useMemo(
      () =>
        SLASH_MENU_GROUP_ORDER.map((group) => ({
          group,
          items: items.filter((item) => item.group === group),
        })).filter((g) => g.items.length > 0),
      [items],
    );
    const flatItems = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

    // 過濾結果變動時重設選取
    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    // 選取項捲入可視範圍
    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event) => {
        if (flatItems.length === 0) return false;
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % flatItems.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i - 1 + flatItems.length) % flatItems.length);
          return true;
        }
        if (event.key === "Enter") {
          const item = flatItems[selectedIndex];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    let flatIndex = -1;

    return (
      <div
        role="listbox"
        aria-label={t("label")}
        className="max-h-[400px] w-80 overflow-y-auto rounded-md border border-edge bg-raised p-1 shadow-md"
      >
        {flatItems.length === 0 ? (
          <div className="px-2 py-2 text-body-ui text-fg-tertiary">{t("empty")}</div>
        ) : (
          grouped.map(({ group, items: groupItems }) => (
            <div key={group}>
              <div className="px-2 pb-1 pt-2 text-caption font-medium text-fg-tertiary">
                {t(`groups.${group}`)}
              </div>
              {groupItems.map((item) => {
                flatIndex += 1;
                const index = flatIndex;
                const Icon = item.icon;
                return (
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
                      <span className="text-body-ui text-fg">
                        {t(`items.${item.id}.label`)}
                      </span>
                      <span className="truncate text-caption text-fg-tertiary">
                        {t(`items.${item.id}.desc`)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    );
  },
);
