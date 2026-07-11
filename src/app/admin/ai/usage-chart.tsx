"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { AiUsageDay, AiUsageSummary } from "@/lib/admin/ai-usage";

type Metric = "count" | "tokens";

const numberFormat = new Intl.NumberFormat("zh-TW");

/**
 * 近 N 日 AI 用量長條圖（L-03，F-ADMIN-04）：可切換「次數／tokens」兩指標，
 * 逐日長條＋總計統計磚。純 SVG-free 版面（flex 長條），主題色以設計 token 呈現。
 */
export function UsageChart({ summary }: { summary: AiUsageSummary }) {
  const t = useTranslations("admin");
  const [metric, setMetric] = useState<Metric>("count");

  const max = useMemo(
    () => summary.days.reduce((m, d) => Math.max(m, d[metric]), 0),
    [summary.days, metric],
  );

  if (summary.totalCount === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-edge px-4 py-10 text-center">
        <p className="text-body-ui font-medium text-fg">{t("aiUsageEmptyTitle")}</p>
        <p className="text-caption text-fg-tertiary">
          {t("aiUsageEmptyDesc", { days: summary.rangeDays })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="flex gap-4">
          <StatTile label={t("aiUsageTotalQueries")} value={numberFormat.format(summary.totalCount)} />
          <StatTile label={t("aiUsageTotalTokens")} value={numberFormat.format(summary.totalTokens)} />
        </dl>
        <div
          className="flex gap-1 rounded-md bg-hover p-0.5"
          role="tablist"
          aria-label={t("aiUsageMetricLabel")}
        >
          <MetricToggle metric="count" active={metric} onSelect={setMetric} label={t("aiUsageMetricCount")} />
          <MetricToggle metric="tokens" active={metric} onSelect={setMetric} label={t("aiUsageMetricTokens")} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div
          className="flex h-40 items-end gap-px border-b border-edge"
          role="img"
          aria-label={t("aiUsageChartAria", { days: summary.rangeDays })}
        >
          {summary.days.map((day) => (
            <UsageBar key={day.date} day={day} metric={metric} max={max} t={t} />
          ))}
        </div>
        <div className="flex justify-between text-caption text-fg-tertiary">
          <span>{summary.days[0]?.date}</span>
          <span>{summary.days[summary.days.length - 1]?.date}</span>
        </div>
      </div>
    </div>
  );
}

function UsageBar({
  day,
  metric,
  max,
  t,
}: {
  day: AiUsageDay;
  metric: Metric;
  max: number;
  t: ReturnType<typeof useTranslations>;
}) {
  const value = day[metric];
  // 非零值至少留 2% 高度，避免小值在圖上看不見；零值為 0（僅見底線）。
  const pct = max > 0 && value > 0 ? Math.max(2, (value / max) * 100) : 0;
  const title = t("aiUsageBarTitle", {
    date: day.date,
    count: numberFormat.format(day.count),
    tokens: numberFormat.format(day.tokens),
  });

  return (
    <div className="group relative flex h-full flex-1 items-end" title={title}>
      <div
        className="w-full rounded-t-sm bg-ai/70 transition-colors group-hover:bg-ai"
        style={{ height: `${pct}%` }}
      />
    </div>
  );
}

function MetricToggle({
  metric,
  active,
  onSelect,
  label,
}: {
  metric: Metric;
  active: Metric;
  onSelect: (m: Metric) => void;
  label: string;
}) {
  const selected = metric === active;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(metric)}
      className={
        selected
          ? "rounded-sm bg-base px-2.5 py-1 text-caption font-medium text-fg shadow-sm"
          : "rounded-sm px-2.5 py-1 text-caption text-fg-secondary hover:text-fg"
      }
    >
      {label}
    </button>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-caption text-fg-tertiary">{label}</dt>
      <dd className="text-h3 font-semibold text-fg">{value}</dd>
    </div>
  );
}
