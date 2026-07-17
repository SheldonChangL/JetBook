"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { reindexAllAction, reindexStatusAction } from "@/actions/admin";
import type { ReindexAllProgress } from "@/lib/jobs/queue";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

/**
 * 全庫重嵌觸發＋進度輪詢（H-07，F-AI-02）。org admin 專用（頁面已擋）；
 * embedding 未設定時停用按鈕。點擊 → server action enqueue → 每 2s 輪詢 job 狀態。
 */
export function ReindexButton({ embeddingConfigured }: { embeddingConfigured: boolean }) {
  const t = useTranslations("admin");
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReindexAllProgress | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!jobId || done) return;
    let cancelled = false;
    const poll = async () => {
      const res = await reindexStatusAction(jobId);
      if (cancelled || !res.ok) return;
      setProgress(res.progress);
      if (TERMINAL_STATES.has(res.state)) setDone(true);
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobId, done]);

  function onTrigger() {
    startTransition(async () => {
      try {
        const res = await reindexAllAction();
        if (!res.ok) {
          toast({ variant: "error", title: t("reindexNotConfigured") });
          return;
        }
        // jobId 為 null：pg-boss singleton 判定已有一個重嵌在進行中（並發觸發）。
        if (!res.jobId) {
          toast({ variant: "info", title: t("reindexAlreadyRunning") });
          return;
        }
        setProgress(null);
        setDone(false);
        setJobId(res.jobId);
        toast({ variant: "success", title: t("reindexQueued") });
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  const running = jobId !== null && !done;

  return (
    <div className="archive-admin-reindex flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ai"
          onClick={onTrigger}
          loading={pending || running}
          disabled={!embeddingConfigured}
        >
          <RefreshCw aria-hidden className="size-4" />
          {t("reindexTrigger")}
        </Button>
        {!embeddingConfigured && (
          <span className="text-caption text-fg-tertiary">{t("reindexNotConfiguredHint")}</span>
        )}
      </div>
      {progress && <ReindexProgressView progress={progress} />}
    </div>
  );
}

function ReindexProgressView({ progress }: { progress: ReindexAllProgress }) {
  const t = useTranslations("admin");
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="archive-admin-reindex-progress flex flex-col gap-2 rounded-md border border-edge bg-sidebar p-3">
      <div className="flex items-center justify-between gap-2 text-body-ui">
        <span className="font-medium text-fg">{t(`reindexPhase.${progress.phase}`)}</span>
        <span className="text-fg-secondary">
          {t("reindexProgress", { done: progress.done, total: progress.total })}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-hover"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-ai transition-all" style={{ width: `${pct}%` }} />
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-secondary">
        <StatItem label={t("reindexIndexed")} value={progress.indexed} />
        <StatItem label={t("reindexCleared")} value={progress.cleared} />
        <StatItem label={t("reindexPurged")} value={progress.purgedDisabledSpaces} />
        <StatItem label={t("reindexFailed")} value={progress.failedCount} />
      </dl>
      {progress.failed.length > 0 && <ReindexFailedList progress={progress} />}
    </div>
  );
}

/**
 * 失敗頁面清單（F-AI-02「失敗清單可重試」）：列出失敗頁 id 與原因樣本
 * （上限見 reindex.ts FAILED_SAMPLE_CAP）；失敗總數超過樣本時附提示。
 * 重試＝再次觸發全庫重嵌（內容雜湊增量、冪等），由上方按鈕重新排入。
 */
function ReindexFailedList({ progress }: { progress: ReindexAllProgress }) {
  const t = useTranslations("admin");
  const remaining = progress.failedCount - progress.failed.length;

  return (
    <details className="rounded-sm border border-danger/40 bg-danger-tint/40 open:pb-2">
      <summary className="cursor-pointer px-2 py-1.5 text-caption font-medium text-danger">
        {t("reindexFailedListTitle", { count: progress.failedCount })}
      </summary>
      <ul className="flex flex-col gap-1 px-2 pt-1 text-caption text-fg-secondary">
        {progress.failed.map((item) => (
          <li key={item.pageId} className="flex flex-col gap-0.5 border-t border-edge pt-1">
            <span className="break-all font-mono text-fg-tertiary">{item.pageId}</span>
            <span className="break-words text-danger">{item.error}</span>
          </li>
        ))}
        {remaining > 0 && (
          <li className="border-t border-edge pt-1 text-fg-tertiary">
            {t("reindexFailedListMore", { count: remaining })}
          </li>
        )}
      </ul>
      <p className="px-2 pt-2 text-caption text-fg-tertiary">{t("reindexFailedRetryHint")}</p>
    </details>
  );
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1">
      <dt>{label}</dt>
      <dd className="font-mono font-medium text-fg">{value}</dd>
    </div>
  );
}
