import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** 快捷鍵標籤（⌘K 等）；Windows 顯示轉換由呼叫端處理。 */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 select-none items-center justify-center rounded-xs border border-edge bg-sidebar px-1 font-mono text-[11px] text-fg-tertiary",
        className,
      )}
      {...props}
    />
  );
}
