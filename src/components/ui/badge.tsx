import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex select-none items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium",
  {
    variants: {
      variant: {
        neutral: "bg-hover text-fg-secondary",
        primary: "bg-primary-tint text-primary",
        success: "bg-success-tint text-success",
        warning: "bg-warning-tint text-warning",
        danger: "bg-danger-tint text-danger",
        // AI 標記專用（設計規範：AI 生成內容一律紫色系）
        ai: "bg-ai-tint text-ai",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
