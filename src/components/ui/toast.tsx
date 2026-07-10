"use client";

import { Toast as ToastPrimitive } from "radix-ui";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

export interface ToastOptions {
  variant?: ToastVariant;
  title: string;
  description?: string;
  /** 可選動作（如「復原」連結） */
  action?: ReactNode;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

/** 取得 toast 發送函式：`const toast = useToast(); toast({ title, variant })`。 */
export function useToast() {
  const push = useContext(ToastContext);
  if (!push) {
    throw new Error("useToast 必須在 <ToastProvider> 內使用");
  }
  return push;
}

const variantIcon: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success" />,
  error: <XCircle aria-hidden className="size-4 shrink-0 text-danger" />,
  info: <Info aria-hidden className="size-4 shrink-0 text-info" />,
};

const MAX_VISIBLE = 3;

export function ToastProvider({
  children,
  closeLabel,
}: {
  children: ReactNode;
  /** 關閉鈕無障礙文字（i18n 由呼叫端提供） */
  closeLabel: string;
}) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((options: ToastOptions) => {
    setItems((prev) => {
      const next = [...prev, { ...options, id: Date.now() + Math.random() }];
      // 右下角堆疊最多 3 個（設計規範 §4.4）
      return next.slice(-MAX_VISIBLE);
    });
  }, []);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            // error 8s、其餘 5s；hover 暫停由 Radix 內建
            duration={item.variant === "error" ? 8000 : 5000}
            onOpenChange={(open) => {
              if (!open) remove(item.id);
            }}
            className="flex w-80 items-start gap-2.5 rounded-md border border-edge bg-raised p-3 shadow-md"
          >
            {variantIcon[item.variant ?? "info"]}
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-body-ui font-medium text-fg">
                {item.title}
              </ToastPrimitive.Title>
              {item.description ? (
                <ToastPrimitive.Description className="mt-0.5 text-caption text-fg-secondary">
                  {item.description}
                </ToastPrimitive.Description>
              ) : null}
              {item.action ? <div className="mt-1.5">{item.action}</div> : null}
            </div>
            <ToastPrimitive.Close
              aria-label={closeLabel}
              className="rounded-xs p-0.5 text-fg-tertiary transition-colors hover:bg-hover hover:text-fg"
            >
              <X aria-hidden className="size-3.5" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport
          className={cn(
            "fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2 outline-none",
          )}
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
