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
    <div className="flex flex-col gap-3">
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
    <div className="flex flex-col gap-2 rounded-md border border-edge bg-sidebar p-3">
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
    </div>
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
