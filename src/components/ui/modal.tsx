"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Modal = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalClose = DialogPrimitive.Close;

const sizeClass = {
  sm: "max-w-[400px]",
  md: "max-w-[560px]",
  lg: "max-w-[720px]",
} as const;

export interface ModalContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** 尺寸（設計規範 §4.4）：sm 400 / md 560 / lg 720px */
  size?: keyof typeof sizeClass;
  title: string;
  description?: string;
  /** 關閉鈕的無障礙文字（i18n 由呼叫端提供） */
  closeLabel: string;
  children?: ReactNode;
}

/** Modal：focus trap、Esc 關閉、鎖捲動由 Radix Dialog 提供。 */
export function ModalContent({
  size = "md",
  title,
  description,
  closeLabel,
  className,
  children,
  ...props
}: ModalContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-edge bg-raised p-6 shadow-lg",
          sizeClass[size],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <DialogPrimitive.Title className="text-h4 text-fg">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="rounded-xs p-1 text-fg-tertiary transition-colors hover:bg-hover hover:text-fg"
          >
            <X aria-hidden className="size-4" />
          </DialogPrimitive.Close>
        </div>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-body-ui text-fg-secondary">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        <div className="mt-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
