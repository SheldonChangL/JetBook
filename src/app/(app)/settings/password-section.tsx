"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { changePasswordAction, type PasswordFailureReason } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const MIN_LENGTH = 10;

const REASON_KEY: Record<PasswordFailureReason, string> = {
  invalid_current: "errCurrentInvalid",
  weak: "errWeak",
  mismatch: "errMismatch",
  same: "errSame",
  not_local: "errNotLocal",
  invalid: "actionError",
};

/**
 * ② 變更密碼（驗收 1）：驗舊密碼 → 新密碼原則 → 送出。成功後其他裝置 session 立即失效
 * （由 server action 撤銷全部 session 並為本裝置重建）。OIDC 帳號改由 SSO 端管理，不提供表單。
 */
export function PasswordSection({ isLocal }: { isLocal: boolean }) {
  const t = useTranslations("settings");
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    current.length > 0 && next.length >= MIN_LENGTH && confirm.length > 0 && next === confirm;

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await changePasswordAction({
        currentPassword: current,
        newPassword: next,
        confirmPassword: confirm,
      });
      if (result.ok) {
        reset();
        toast({ variant: "success", title: t("passwordChanged") });
      } else {
        toast({ variant: "error", title: t(REASON_KEY[result.reason]) });
      }
    });
  }

  return (
    <section id="password" aria-labelledby="password-heading" className="archive-personal-section flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="password-heading" className="text-h4 text-fg">
          {t("passwordHeading")}
        </h2>
        <p className="text-body-ui text-fg-secondary">{t("passwordDesc")}</p>
      </div>

      {isLocal ? (
        <form
          onSubmit={onSubmit}
          className="archive-personal-card flex flex-col gap-4 rounded-md border border-edge bg-raised p-4"
        >
          <Input
            type="password"
            label={t("currentPasswordLabel")}
            autoComplete="current-password"
            value={current}
            required
            onChange={(e) => setCurrent(e.target.value)}
          />
          <Input
            type="password"
            label={t("newPasswordLabel")}
            autoComplete="new-password"
            helper={t("passwordHelper", { min: MIN_LENGTH })}
            error={tooShort ? t("errWeak") : undefined}
            value={next}
            required
            onChange={(e) => setNext(e.target.value)}
          />
          <Input
            type="password"
            label={t("confirmPasswordLabel")}
            autoComplete="new-password"
            error={mismatch ? t("errMismatch") : undefined}
            value={confirm}
            required
            onChange={(e) => setConfirm(e.target.value)}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={pending} disabled={!canSubmit}>
              {t("changePasswordButton")}
            </Button>
          </div>
        </form>
      ) : (
        <p className="rounded-md border border-edge bg-raised px-4 py-3 text-body-ui text-fg-secondary">
          {t("ssoManaged")}
        </p>
      )}
    </section>
  );
}
