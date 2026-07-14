"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import {
  importUsersAction,
  previewUserImportAction,
  type UserImportOutcome,
  type UserImportPreviewResult,
} from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type PreviewRows = Extract<UserImportPreviewResult, { ok: true }>["rows"];
type ImportResults = Extract<UserImportOutcome, { ok: true }>;

/**
 * CSV 批次建立使用者（M4-02）：選檔 → 預覽（逐列標示錯誤）→ 建立 → 結果
 * （初始密碼僅顯示一次）。Redmine 以其 CSV 匯出餵入。
 */
export function ImportUsersButton() {
  const t = useTranslations("admin.import");
  const tRole = useTranslations("admin.role");
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRows | null>(null);
  const [result, setResult] = useState<ImportResults | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setCsv("");
    setFileError(null);
    setPreview(null);
    setResult(null);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) reset();
  }

  function onFileSelected(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsv(text);
      startTransition(async () => {
        try {
          const res = await previewUserImportAction({ csv: text });
          if (!res.ok) {
            setFileError(res.error);
            setPreview(null);
            return;
          }
          setPreview(res.rows);
        } catch {
          toast({ variant: "error", title: t("actionError") });
        }
      });
    };
    reader.readAsText(file);
  }

  function onImport() {
    startTransition(async () => {
      try {
        const res = await importUsersAction({ csv });
        if (!res.ok) {
          setFileError(res.error);
          return;
        }
        setResult(res);
        setPreview(null);
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  const validCount = preview?.filter((r) => !r.error).length ?? 0;
  const invalidCount = (preview?.length ?? 0) - validCount;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalTrigger asChild>
        <Button variant="secondary">
          <Upload aria-hidden className="size-4" />
          {t("button")}
        </Button>
      </ModalTrigger>
      <ModalContent size="lg" title={t("title")} closeLabel={t("close")}>
        <div className="flex flex-col gap-4">
          {result === null && (
            <>
              <p className="text-body-ui text-fg-secondary">{t("fileHelper")}</p>
              <div className="flex items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => onFileSelected(e.target.files?.[0])}
                />
                <Button
                  variant="secondary"
                  loading={pending && preview === null}
                  onClick={() => fileRef.current?.click()}
                >
                  {t("selectFile")}
                </Button>
                {fileError && (
                  <span className="text-body-ui text-danger">
                    {t(`fileError.${fileError}`)}
                  </span>
                )}
              </div>
            </>
          )}

          {preview !== null && result === null && (
            <>
              <p className="text-body-ui text-fg">
                {t("previewSummary", { valid: validCount, invalid: invalidCount })}
              </p>
              <div className="max-h-80 overflow-y-auto rounded-md border border-edge">
                <table className="w-full text-body-ui">
                  <thead>
                    <tr className="border-b border-edge bg-sidebar text-left text-caption text-fg-tertiary">
                      <th className="px-3 py-2 font-medium">{t("colLine")}</th>
                      <th className="px-3 py-2 font-medium">{t("colEmail")}</th>
                      <th className="px-3 py-2 font-medium">{t("colName")}</th>
                      <th className="px-3 py-2 font-medium">{t("colRole")}</th>
                      <th className="px-3 py-2 font-medium">{t("colStatus")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={row.line} className="border-b border-edge last:border-b-0">
                        <td className="px-3 py-1.5 text-fg-tertiary">{row.line}</td>
                        <td className="px-3 py-1.5">{row.email || "—"}</td>
                        <td className="px-3 py-1.5">{row.name}</td>
                        <td className="px-3 py-1.5">{tRole(row.orgRole)}</td>
                        <td className="px-3 py-1.5">
                          {row.error ? (
                            <Badge variant="danger">{t(`rowError.${row.error}`)}</Badge>
                          ) : (
                            <Badge variant="success">{t("rowOk")}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={reset}>
                  {t("back")}
                </Button>
                <Button onClick={onImport} loading={pending} disabled={validCount === 0}>
                  {t("importConfirm", { count: validCount })}
                </Button>
              </div>
            </>
          )}

          {result !== null && (
            <>
              <p className="text-body-ui text-fg">
                {t("resultSummary", { created: result.created, skipped: result.skipped })}
              </p>
              <p className="rounded-md bg-sidebar px-3 py-2 text-body-ui text-warning">
                {t("passwordOnce")}
              </p>
              <div className="max-h-80 overflow-y-auto rounded-md border border-edge">
                <table className="w-full text-body-ui">
                  <thead>
                    <tr className="border-b border-edge bg-sidebar text-left text-caption text-fg-tertiary">
                      <th className="px-3 py-2 font-medium">{t("colEmail")}</th>
                      <th className="px-3 py-2 font-medium">{t("colName")}</th>
                      <th className="px-3 py-2 font-medium">{t("colPassword")}</th>
                      <th className="px-3 py-2 font-medium">{t("colStatus")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((row) => (
                      <tr key={row.line} className="border-b border-edge last:border-b-0">
                        <td className="px-3 py-1.5">{row.email || "—"}</td>
                        <td className="px-3 py-1.5">{row.name}</td>
                        <td className="px-3 py-1.5 font-mono">
                          {row.password ?? "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {row.status === "created" ? (
                            <Badge variant="success">{t("statusCreated")}</Badge>
                          ) : (
                            <Badge variant="danger">
                              {row.reason ? t(`rowError.${row.reason}`) : t("statusSkipped")}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => setOpen(false)}>{t("close")}</Button>
              </div>
            </>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}
