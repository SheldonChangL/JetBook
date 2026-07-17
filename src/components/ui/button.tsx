import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { Slot } from "radix-ui";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium transition-colors disabled:pointer-events-none disabled:text-fg-disabled",
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary hover:bg-primary-hover disabled:bg-hover",
        secondary: "border border-edge-strong bg-raised text-fg hover:bg-hover disabled:bg-base",
        ghost: "text-fg-secondary hover:bg-hover hover:text-fg",
        danger: "bg-danger text-on-danger hover:opacity-90 disabled:bg-hover",
        // AI 專用紫（僅限 AI 相關動作，見設計規範 §4.1）
        ai: "bg-ai text-on-ai hover:opacity-90 disabled:bg-hover",
      },
      size: {
        sm: "h-7 px-2.5 text-caption",
        md: "h-9 px-3.5 text-body-ui",
        lg: "h-11 px-5 text-body-ui",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** 以子元素為實際節點（如包 Link） */
  asChild?: boolean;
  /** 載入中：顯示 spinner、停用互動、寬度不跳動 */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || loading}
      data-loading={loading || undefined}
      {...props}
    >
      {/* asChild 時 Slot 需單一子元素，只傳 children（loading 不適用連結型按鈕） */}
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}

export { buttonVariants };
