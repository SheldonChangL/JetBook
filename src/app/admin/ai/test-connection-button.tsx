"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Plug, XCircle } from "lucide-react";
import { testAiConnectionAction } from "@/actions/admin";
import type { ConnectionTestOutcome } from "@/lib/llm/settings";
import { Button } from "@/components/ui/button";

/**
 * 連線測試按鈕（L-03，F-ADMIN-04）：實打指定 provider（server action），
 * 成功顯示綠勾、失敗顯示紅叉＋錯誤原因。未設定時停用。
 */
export function TestConnectionButton({
  target,
  configured,
}: {
  target: "llm" | "embedding";
  configured: boolean;
}) {
  const t = useTranslations("admin");
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<ConnectionTestOutcome | null>(null);

  function onTest() {
    startTransition(async () => {
      setOutcome(null);
      try {
        const res = await testAiConnectionAction(target);
        setOutcome(res.ok ? res.outcome : { status: "error", message: t("actionError") });
      } catch {
        setOutcome({ status: "error", message: t("actionError") });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="secondary" onClick={onTest} loading={pending} disabled={!configured}>
          <Plug aria-hidden className="size-4" />
          {t("aiTestConnection")}
        </Button>
      </div>
      {outcome && <ConnectionOutcomeView outcome={outcome} />}
    </div>
  );
}

function ConnectionOutcomeView({ outcome }: { outcome: ConnectionTestOutcome }) {
  const t = useTranslations("admin");

  if (outcome.status === "ok") {
    return (
      <p className="flex items-center gap-1.5 text-caption text-success" role="status">
        <CheckCircle2 aria-hidden className="size-4 shrink-0" />
        {t("aiTestOk")}
      </p>
    );
  }
  if (outcome.status === "unconfigured") {
    return (
      <p className="flex items-center gap-1.5 text-caption text-fg-tertiary" role="status">
        {t("aiTestUnconfigured")}
      </p>
    );
  }
  return (
    <div className="flex items-start gap-1.5 text-caption text-danger" role="alert">
      <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{t("aiTestFailed")}</span>
        <span className="break-words font-mono text-fg-secondary">{outcome.message}</span>
      </span>
    </div>
  );
}
