import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * 骨架屏：形狀對應真實內容（設計規範 §5.3）。
 * shimmer 動畫在 prefers-reduced-motion 下由全域規則自動停用（退化為靜態淡色）。
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-xs bg-hover", className)}
      {...props}
    />
  );
}
