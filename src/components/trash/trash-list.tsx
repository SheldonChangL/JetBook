"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText, RotateCcw } from "lucide-react";
import { restorePage } from "@/actions/trash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export interface TrashRow {
  pageId: string;
  title: string;
  icon: string | null;
  spaceSlug: string;
  spaceName: string;
  spaceIcon: string | null;
  /** 刪除時間的相對描述（伺服器端以 i18n 映射，已本地化） */
  deletedLabel: string;
  /** 距永久清除剩餘天數（0＝即將清除） */
  daysLeft: number;
  deleterName: string | null;
  descendantCount: number;
}

/**
 * 回收桶列表（C-08）：每列為一批已刪頁面的頂節點——標題／所屬空間／刪除者／
 * 刪除時間＋還原鈕。還原連帶同批後代子樹；原父已刪則掛回最上層（toast 提示）。
 */
export function TrashList({ items, showSpace }: { items: TrashRow[]; showSpace: boolean }) {
  const t = useTranslations("trash");
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  function handleRestore(item: TrashRow) {
    setRestoringId(item.pageId);
    startTransition(async () => {
      try {
        const res = await restorePage({ pageId: item.pageId });
        toast({
          variant: "success",
          title: res.reparentedToRoot
            ? t("restoredToRoot", { title: item.title })
            : t("restored", { title: item.title }),
        });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("restoreError") });
      } finally {
        setRestoringId(null);
      }
    });
  }

  return (
    <ul className="flex flex-col divide-y divide-edge overflow-hidden rounded-md border border-edge">
      {items.map((item) => {
        const isRestoring = pending && restoringId === item.pageId;
        return (
          <li
            key={item.pageId}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-raised px-4 py-3"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {item.icon ? (
                <span aria-hidden className="shrink-0 text-base leading-none">
                  {item.icon}
                </span>
              ) : (
                <FileText aria-hidden className="size-4 shrink-0 text-fg-tertiary" />
              )}
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-body-ui font-medium text-fg">
                  <span className="truncate">{item.title}</span>
                  {item.descendantCount > 0 ? (
                    <Badge variant="neutral">
                      {t("childrenCount", { count: item.descendantCount })}
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-fg-tertiary">
                  {showSpace ? (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden>{item.spaceIcon ?? "📘"}</span>
                      {item.spaceName}
                    </span>
                  ) : null}
                  <span>{t("colDeletedBy")}：{item.deleterName ?? t("unknownUser")}</span>
                  <span aria-hidden>·</span>
                  <span>{item.deletedLabel}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Badge variant={item.daysLeft <= 3 ? "warning" : "neutral"}>
                {item.daysLeft <= 0 ? t("purgeSoon") : t("daysLeft", { days: item.daysLeft })}
              </Badge>
              <Button
                size="sm"
                variant="secondary"
                loading={isRestoring}
                disabled={pending}
                onClick={() => handleRestore(item)}
              >
                <RotateCcw aria-hidden className="size-4" />
                {t("restore")}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
