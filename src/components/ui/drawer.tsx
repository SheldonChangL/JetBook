"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export interface DrawerContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  title: string;
  closeLabel: string;
  /** 額外放在頂列右側（關閉鈕左邊）的動作 */
  headerActions?: ReactNode;
  children?: ReactNode;
}

/** 右側滑入抽屜（AI、評論用）；focus 規則同 Modal（Radix Dialog）。 */
export function DrawerContent({
  title,
  closeLabel,
  headerActions,
  className,
  children,
  ...props
}: DrawerContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-[calc(100vw-32px)] flex-col border-l border-edge bg-raised shadow-lg",
          className,
        )}
        {...props}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-edge px-4">
          <DialogPrimitive.Title className="text-h4 text-fg">{title}</DialogPrimitive.Title>
          <div className="flex items-center gap-1">
            {headerActions}
            <DialogPrimitive.Close
              aria-label={closeLabel}
              className="rounded-xs p-1 text-fg-tertiary transition-colors hover:bg-hover hover:text-fg"
            >
              <X aria-hidden className="size-4" />
            </DialogPrimitive.Close>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
