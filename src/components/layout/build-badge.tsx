"use client";

import { useTranslations } from "next-intl";
import type { BuildInfo } from "@/lib/build-info";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * 常駐 build 版本 badge（#267）：讓使用者一眼分辨當前部署的版本／commit。
 * 顯示 v{version}·{短碼}；hover 顯示完整 commit 與建置時間。放各 shell topbar，不隨側欄收合。
 */
export function BuildBadge({ info, className }: { info: BuildInfo; className?: string }) {
  const t = useTranslations("shell");
  const tooltip = info.builtAt
    ? t("buildTooltip", { commit: info.commit, builtAt: info.builtAt })
    : t("buildTooltipDev", { commit: info.commit });

  return (
    <Tooltip content={tooltip}>
      <span
        aria-label={t("buildBadgeLabel", { version: info.version, commit: info.shortCommit })}
        className={cn(
          "select-none rounded-xs border border-edge px-1.5 py-0.5 font-mono text-[10px] leading-none text-fg-tertiary",
          className,
        )}
      >
        {t("buildBadgeText", { version: info.version, commit: info.shortCommit })}
      </span>
    </Tooltip>
  );
}
