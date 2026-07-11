"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { requestPasswordReset, type ForgotState } from "@/actions/password-reset";
import { Button } from "@/components/ui/button";

const initialState: ForgotState = { status: "idle" };

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  if (state.status === "sent") {
    return (
      <div className="flex flex-col gap-4">
        <div
          role="status"
          className="rounded-sm border border-edge bg-base px-3 py-2 text-body-ui text-fg-secondary"
        >
          {t("forgotSent")}
        </div>
        <Link href="/login" className="text-center text-body-ui text-primary hover:underline">
          {t("backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-body-ui text-fg-secondary">{t("forgotDescription")}</p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="forgot-email" className="text-body-ui font-medium text-fg">
          {t("email")}
        </label>
        <input
          id="forgot-email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="h-9 w-full rounded-sm border border-edge-strong bg-base px-3 text-body-ui text-fg placeholder:text-fg-tertiary focus-visible:border-primary"
        />
      </div>

      <Button type="submit" loading={pending} className="w-full" size="lg">
        {pending ? t("forgotSubmitting") : t("forgotSubmit")}
      </Button>

      <Link href="/login" className="text-center text-body-ui text-primary hover:underline">
        {t("backToLogin")}
      </Link>
    </form>
  );
}
