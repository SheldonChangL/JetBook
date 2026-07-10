"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 無障礙必填：icon-only 按鈕的說明文字，同時作為 tooltip 內容 */
  label: string;
  children: ReactNode;
}

/** 32×32 icon 按鈕；label 必填（aria-label + tooltip，設計規範 §4.4）。 */
export function IconButton({ label, className, children, ...props }: IconButtonProps) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:text-fg-disabled",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
}
