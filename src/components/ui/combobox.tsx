"use client";

import { Command } from "cmdk";
import { Check, ChevronsUpDown } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** 觸發器占位文字（i18n 由呼叫端提供） */
  placeholder: string;
  /** 搜尋輸入占位文字 */
  searchPlaceholder: string;
  /** 無結果文字 */
  emptyText: string;
  disabled?: boolean;
  className?: string;
}

/** 搜尋式選單（成員選擇、語言選擇用；cmdk 提供鍵盤導航與過濾）。 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-edge-strong bg-base px-3 text-body-ui transition-colors disabled:bg-hover disabled:text-fg-disabled",
            selected ? "text-fg" : "text-fg-tertiary",
            className,
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-fg-tertiary" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <Command.Input
            placeholder={searchPlaceholder}
            className="h-9 w-full border-b border-edge bg-transparent px-3 text-body-ui text-fg outline-none placeholder:text-fg-tertiary"
          />
          <Command.List id={listId} className="max-h-60 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-2 text-body-ui text-fg-tertiary">
              {emptyText}
            </Command.Empty>
            {options.map((option) => (
              <Command.Item
                key={option.value}
                value={option.label}
                onSelect={() => {
                  onValueChange(option.value === value ? null : option.value);
                  setOpen(false);
                }}
                className="flex cursor-default select-none items-center justify-between gap-2 rounded-xs px-2 py-1.5 text-body-ui text-fg data-[selected=true]:bg-hover"
              >
                <span className="truncate">{option.label}</span>
                {option.value === value ? (
                  <Check aria-hidden className="size-4 text-primary" />
                ) : null}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
