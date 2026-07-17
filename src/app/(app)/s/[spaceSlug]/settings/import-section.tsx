"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileArchive, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** 進度／結果報告（對齊 lib/jobs/queue.ts 的 ImportZipProgress）。 */
interface ImportProgress {
  phase: "unzipping" | "importing" | "completed" | "failed";
  processed: number;
  total: number;
  createdPages: number;
  uploadedImages: number;
  rewrittenImageLinks: number;
  skipped: { path: string; reason: string }[];
  errorCode?: string;
  errorMessage?: string;
}

interface StatusResponse {
  data?: { state: string; progress: ImportProgress | null };
  error?: { code: string; message: string };
}

const ERROR_CODES = new Set([
  "TOO_MANY_ENTRIES",
  "FILE_TOO_LARGE",
  "TOTAL_TOO_LARGE",
  "PATH_TRAVERSAL",
  "INVALID_ZIP",
  "EMPTY_ARCHIVE",
  "UNKNOWN",
]);

const POLL_INTERVAL_MS = 1500;
/** 前端壓縮檔大小上限（bytes）：對齊 server 端 MAX_ZIP_UPLOAD_BYTES（100MB）。 */
const MAX_ZIP_BYTES = 100 * 1024 * 1024;

/**
 * 空間設定「批次匯入」（J-02，G2）：上傳 zip → POST /api/import 取得 jobId →
 * 輪詢 /api/import/[jobId] 顯示進度與成功／失敗報告。實際解壓與建頁在 worker。
 */
export function ImportSection({ spaceId, spaceSlug }: { spaceId: string; spaceSlug: string }) {
  const t = useTranslations("spaceSettings");
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const busy = uploading || (jobId !== null && progress?.phase !== "completed" && progress?.phase !== "failed");

  // 輪詢 job 狀態。
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/import/${jobId}`, { cache: "no-store" });
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

  const onSelect = useCallback(() => fileInputRef.current?.click(), []);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const picked = input.files?.[0] ?? null;
    input.value = "";
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith(".zip")) {
      toast({ variant: "error", title: t("importInvalidType") });
      return;
    }
    if (picked.size > MAX_ZIP_BYTES) {
      toast({ variant: "error", title: t("importTooLarge") });
      return;
    }
    setFile(picked);
    setJobId(null);
    setProgress(null);
  }

  async function onStart() {
    if (!file || busy) return;
    setUploading(true);
    setProgress(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("spaceId", spaceId);
      const res = await fetch("/api/import", { method: "POST", body: form });
      const body = (await res.json()) as { data?: { jobId: string }; error?: { message: string } };
      if (!res.ok || !body.data?.jobId) {
        toast({ variant: "error", title: body.error?.message ?? t("importError") });
        return;
      }
      setJobId(body.data.jobId);
    } catch {
      toast({ variant: "error", title: t("importError") });
    } finally {
      setUploading(false);
    }
  }

  function phaseLabel(): string {
    if (uploading) return t("importUploading");
    if (!progress) return "";
    if (progress.phase === "unzipping") return t("importUnzipping");
    if (progress.phase === "importing") return t("importImporting");
    return "";
  }

  function errorLabel(code: string | undefined): string {
    const key = code && ERROR_CODES.has(code) ? code : "UNKNOWN";
    return t(`importErr${key}`);
  }

  return (
    <section id="import" aria-labelledby="import-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="import-heading" className="text-h4 text-fg">
          {t("importHeading")}
        </h2>
        <p className="text-body-ui text-fg-secondary">{t("importDesc")}</p>
      </div>

      <div className="flex flex-col gap-4 rounded-md border border-edge bg-raised p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="sr-only"
            onChange={onFileChange}
          />
          <Button variant="secondary" onClick={onSelect} disabled={busy}>
            <FileArchive aria-hidden className="size-4" />
            {t("importSelectButton")}
          </Button>
          <span className="text-body-ui text-fg-secondary">{file ? file.name : t("importNoFile")}</span>
          <Button variant="primary" onClick={onStart} disabled={!file || busy} loading={busy} className="ml-auto">
            <Upload aria-hidden className="size-4" />
            {t("importStartButton")}
          </Button>
        </div>

        {busy && phaseLabel() ? (
          <p className="text-body-ui text-fg-secondary" role="status" aria-live="polite">
            {phaseLabel()}
            {progress && progress.total > 0
              ? ` — ${t("importProgress", { done: progress.createdPages, total: progress.total })}`
              : ""}
          </p>
        ) : null}

        {progress && progress.phase === "completed" ? (
          <div className="flex flex-col gap-2 rounded-md border border-edge bg-success-tint px-4 py-3" role="status">
            <p className="text-body-ui font-medium text-success">{t("importCompleted")}</p>
            <p className="text-body-ui text-fg-secondary">
              {t("importCompletedSummary", {
                pages: progress.createdPages,
                images: progress.uploadedImages,
              })}
            </p>
            {progress.rewrittenImageLinks > 0 ? (
              <p className="text-caption text-fg-tertiary">
                {t("importRewritten", { count: progress.rewrittenImageLinks })}
              </p>
            ) : null}
            {progress.skipped.length > 0 ? (
              <p className="text-caption text-fg-tertiary">
                {t("importSkipped", { count: progress.skipped.length })}
              </p>
            ) : null}
            <Link
              href={`/s/${spaceSlug}`}
              className="text-body-ui text-primary underline-offset-2 hover:underline"
            >
              {t("importViewSpace")}
            </Link>
          </div>
        ) : null}

        {progress && progress.phase === "failed" ? (
          <div className="flex flex-col gap-1 rounded-md border border-edge bg-danger-tint px-4 py-3" role="alert">
            <p className="text-body-ui font-medium text-danger">{t("importFailed")}</p>
            <p className="text-body-ui text-fg-secondary">{errorLabel(progress.errorCode)}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
