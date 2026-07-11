"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** 進度／結果報告（對齊 /api/export/[jobId] 回傳，storageKey 已由 route 剝除）。 */
interface ExportProgress {
  phase: "collecting" | "packaging" | "completed" | "failed";
  processed: number;
  total: number;
  exportedPages: number;
  includedAssets: number;
  fileName: string | null;
  sizeBytes: number | null;
  downloadable: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

interface StatusResponse {
  data?: { state: string; progress: ExportProgress | null };
  error?: { code: string; message: string };
}

const POLL_INTERVAL_MS = 1500;

/**
 * 空間設定「匯出」（J-03，F-IE-02）：POST /api/export 取得 jobId → 輪詢
 * /api/export/[jobId] 顯示進度 → 完成後提供權限保護的下載連結。實際遍歷樹／打包在 worker。
 */
export function ExportSection({ spaceId }: { spaceId: string }) {
  const t = useTranslations("spaceSettings");
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);

  const done = progress?.phase === "completed" || progress?.phase === "failed";
  const busy = starting || (jobId !== null && !done);

  // 輪詢 job 狀態。
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/export/${jobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as StatusResponse;
        if (!active || !body.data?.progress) return;
        setProgress(body.data.progress);
        if (body.data.progress.phase === "completed" || body.data.progress.phase === "failed") {
          active = false;
          clearInterval(timer);
        }
      } catch {
        // 網路瞬斷：下一輪重試
      }
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    void tick();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [jobId]);

  async function onStart() {
    if (busy) return;
    setStarting(true);
    setProgress(null);
    setJobId(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      });
      const body = (await res.json()) as { data?: { jobId: string }; error?: { message: string } };
      if (!res.ok || !body.data?.jobId) {
        toast({ variant: "error", title: body.error?.message ?? t("exportError") });
        return;
      }
      setJobId(body.data.jobId);
    } catch {
      toast({ variant: "error", title: t("exportError") });
    } finally {
      setStarting(false);
    }
  }

  function phaseLabel(): string {
    if (starting) return t("exportStarting");
    if (!progress) return "";
    if (progress.phase === "collecting") return t("exportCollecting");
    if (progress.phase === "packaging") return t("exportPackaging");
    return "";
  }

  return (
    <section aria-labelledby="export-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="export-heading" className="text-h4 text-fg">
          {t("exportHeading")}
        </h2>
        <p className="text-body-ui text-fg-secondary">{t("exportDesc")}</p>
      </div>

      <div className="flex flex-col gap-4 rounded-md border border-edge bg-raised p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={onStart} disabled={busy} loading={busy}>
            <FileDown aria-hidden className="size-4" />
            {t("exportStartButton")}
          </Button>
        </div>

        {busy && phaseLabel() ? (
          <p className="text-body-ui text-fg-secondary" role="status" aria-live="polite">
            {phaseLabel()}
            {progress && progress.total > 0
              ? ` — ${t("exportProgress", { done: progress.exportedPages, total: progress.total })}`
              : ""}
          </p>
        ) : null}

        {progress && progress.phase === "completed" ? (
          <div className="flex flex-col gap-2 rounded-md border border-edge bg-success-tint px-4 py-3" role="status">
            <p className="text-body-ui font-medium text-success">{t("exportCompleted")}</p>
            <p className="text-body-ui text-fg-secondary">
              {t("exportCompletedSummary", {
                pages: progress.exportedPages,
                assets: progress.includedAssets,
              })}
            </p>
            {progress.downloadable && jobId ? (
              <a
                href={`/api/export/${jobId}/download`}
                className="inline-flex w-fit items-center gap-1.5 text-body-ui text-primary underline-offset-2 hover:underline"
              >
                <Download aria-hidden className="size-4" />
                {t("exportDownload")}
              </a>
            ) : null}
          </div>
        ) : null}

        {progress && progress.phase === "failed" ? (
          <div className="flex flex-col gap-1 rounded-md border border-edge bg-danger-tint px-4 py-3" role="alert">
            <p className="text-body-ui font-medium text-danger">{t("exportFailed")}</p>
            <p className="text-body-ui text-fg-secondary">{t("exportErrUNKNOWN")}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
