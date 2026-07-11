"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { GitCompareArrows } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 版本列表項（可序列化，供 client 勾選比較；E-04）。 */
export interface VersionListItem {
  id: string;
  versionNo: number;
  note: string | null;
  authorName: string | null;
  createdAtMs: number;
}

const formatTime = (ms: number) =>
  new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));

/**
 * 版本列表側欄（E-02 選版 + E-04 任兩版比較）。
 * 點列為檢視該版快照；勾選任兩版並按「比較所選版本」進入差異檢視。
 */
export function VersionSidebar({
  versions,
  spaceSlug,
  pageSlug,
  selectedVersionNo,
  activeTab,
  compareFrom,
  compareTo,
}: {
  versions: VersionListItem[];
  spaceSlug: string;
  pageSlug: string;
  selectedVersionNo: number | null;
  activeTab: "snapshot" | "diff";
  compareFrom?: number;
  compareTo?: number;
}) {
  const t = useTranslations("versionHistory");
  const router = useRouter();
  const base = `/s/${spaceSlug}/${pageSlug}/history`;

  // 進入差異檢視時，預先勾選當前比較的兩版
  const initialChecked = useMemo(() => {
    if (activeTab === "diff" && compareFrom != null && compareTo != null) {
      return [compareFrom, compareTo];
    }
    return [] as number[];
  }, [activeTab, compareFrom, compareTo]);
  const [checked, setChecked] = useState<number[]>(initialChecked);

  const twoSelected = checked.length === 2;

  function toggle(versionNo: number) {
    setChecked((prev) => {
      if (prev.includes(versionNo)) return prev.filter((n) => n !== versionNo);
      if (prev.length >= 2) return prev; // 已選滿兩個：需先取消才能改選
      return [...prev, versionNo];
    });
  }

  function compare() {
    const [a, b] = checked;
    if (a == null || b == null) return;
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    router.push(`${base}?tab=diff&from=${from}&to=${to}`);
  }

  return (
    <>
      <div className="border-b border-edge px-4 py-2">
        {twoSelected ? (
          <div className="flex items-center gap-2">
            <Button size="sm" className="flex-1" onClick={compare}>
              <GitCompareArrows aria-hidden className="size-4" />
              {t("compareSelected")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChecked([])}>
              {t("clearSelection")}
            </Button>
          </div>
        ) : (
          <p className="text-caption text-fg-tertiary">{t("compareHint")}</p>
        )}
      </div>
      <nav aria-label={t("listLabel")} className="min-h-0 flex-1 overflow-y-auto py-2">
        {versions.length === 0 ? (
          <p className="px-4 py-6 text-caption text-fg-tertiary">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col">
            {versions.map((item) => {
              const isChecked = checked.includes(item.versionNo);
              const isCompared =
                activeTab === "diff" &&
                (item.versionNo === compareFrom || item.versionNo === compareTo);
              const isSelected = activeTab === "snapshot" && item.versionNo === selectedVersionNo;
              const disabled = twoSelected && !isChecked;
              return (
                <li key={item.id}>
                  <div
                    className={cn(
                      "flex items-start gap-2 border-l-2 px-3 py-2.5 transition-colors",
                      isSelected || isCompared
                        ? "border-primary bg-primary-tint"
                        : "border-transparent hover:bg-hover",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 accent-primary disabled:opacity-40"
                      checked={isChecked}
                      disabled={disabled}
                      onChange={() => toggle(item.versionNo)}
                      aria-label={t("compareCheckboxLabel", { n: item.versionNo })}
                    />
                    <Link href={`${base}?v=${item.versionNo}`} className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-body-ui font-medium text-fg">
                          {t("versionLabel", { n: item.versionNo })}
                        </span>
                        {item.note ? (
                          <Badge variant="primary">{item.note}</Badge>
                        ) : (
                          <Badge variant="neutral">{t("autoSnapshot")}</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-caption text-fg-secondary">
                        {item.authorName ?? t("unknownAuthor")}
                      </p>
                      <p className="text-caption text-fg-tertiary">{formatTime(item.createdAtMs)}</p>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </>
  );
}
