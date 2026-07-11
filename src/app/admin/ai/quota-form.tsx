"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setAiDailyQuotaAction } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/**
 * AI 每人每日配額設定表單（I-09，F-AI-11）。org admin 專用（頁面已擋）。
 * 空白＝不限制（null）；否則須為 1 以上的整數。送出經 server action 寫入 org_settings，
 * 強制執行點在 /api/ai/chat。
 */
export function QuotaForm({ currentQuota }: { currentQuota: number | null }) {
  const t = useTranslations("admin");
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentQuota === null ? "" : String(currentQuota));
  const [error, setError] = useState<string | null>(null);

  function onSave() {
    const trimmed = value.trim();
    let quota: number | null;
    if (trimmed === "") {
      quota = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1) {
        setError(t("aiQuotaInvalid"));
        return;
      }
      quota = n;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await setAiDailyQuotaAction({ quota });
        if (!res.ok) {
          setError(t("aiQuotaInvalid"));
          return;
        }
        // 正規化顯示（去除前導零／空白）。
        setValue(quota === null ? "" : String(quota));
        toast({ variant: "success", title: t("aiQuotaSaved") });
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-ui text-fg-secondary">{t("aiQuotaDesc")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            className="w-40"
            label={t("aiQuotaFieldLabel")}
            placeholder={t("aiQuotaPlaceholder")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={error ?? undefined}
          />
          <span className="pb-2 text-body-ui text-fg-tertiary">{t("aiQuotaUnit")}</span>
        </div>
        <Button variant="primary" onClick={onSave} loading={pending} className="mb-0.5">
          {t("aiQuotaSave")}
        </Button>
      </div>
      <p className="text-caption text-fg-tertiary">{t("aiQuotaHint")}</p>
    </div>
  );
}
