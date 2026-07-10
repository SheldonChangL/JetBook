import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** 置中插圖／icon（120px 區域，設計規範 §3.12） */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** 主要 CTA */
  action?: ReactNode;
  className?: string;
}

/** 空狀態統一模板：置中 icon＋標題＋一句說明＋主要 CTA（設計規範 §3.12）。 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12", className)}
    >
      {icon ? (
        <div aria-hidden className="mb-2 text-fg-tertiary [&>svg]:size-12">
          {icon}
        </div>
      ) : null}
      <h3 className="text-h3 text-fg">{title}</h3>
      {description ? (
        <p className="max-w-sm text-center text-body-ui text-fg-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
