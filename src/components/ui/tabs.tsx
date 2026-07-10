"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export interface TabsListProps extends ComponentProps<typeof TabsPrimitive.List> {
  /** underline＝設定頁底線式；pill＝篩選膠囊式（設計規範 §4.4） */
  variant?: "underline" | "pill";
}

export function TabsList({ variant = "underline", className, ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      data-variant={variant}
      className={cn(
        variant === "underline"
          ? "flex items-center gap-4 border-b border-edge"
          : "inline-flex items-center gap-1 rounded-md bg-sidebar p-1",
        className,
      )}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends ComponentProps<typeof TabsPrimitive.Trigger> {
  variant?: "underline" | "pill";
}

export function TabsTrigger({ variant = "underline", className, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "text-body-ui text-fg-secondary transition-colors hover:text-fg disabled:pointer-events-none disabled:text-fg-disabled",
        variant === "underline"
          ? "-mb-px border-b-2 border-transparent pb-2 data-[state=active]:border-primary data-[state=active]:text-fg"
          : "rounded-sm px-3 py-1 data-[state=active]:bg-raised data-[state=active]:text-fg data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
