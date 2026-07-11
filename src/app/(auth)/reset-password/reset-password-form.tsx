"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { resetPassword, type ResetState } from "@/actions/password-reset";
import { Button } from "@/components/ui/button";

const initialState: ResetState = { status: "idle" };

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(resetPassword, initialState);
  const [showPassword, setShowPassword] = useState(false);

  const errorMessage =
    state.status !== "error"
      ? null
      : state.code === "mismatch"
        ? t("resetMismatch")
        : state.code === "weak"
          ? t("resetWeak")
          : t("resetTokenInvalid");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {errorMessage ? (
        <div
          role="alert"
          className="rounded-sm border border-danger/30 bg-danger-tint px-3 py-2 text-body-ui text-danger"
        >
          {errorMessage}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reset-password" className="text-body-ui font-medium text-fg">
          {t("newPassword")}
        </label>
        <div className="relative">
          <input
            id="reset-password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            minLength={10}
            autoComplete="new-password"
            className="h-9 w-full rounded-sm border border-edge-strong bg-base px-3 pr-10 text-body-ui text-fg focus-visible:border-primary"
          />
          <button
            type="button"
            aria-label={showPassword ? t("hidePassword") : t("showPassword")}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xs p-1 text-fg-tertiary transition-colors hover:text-fg"
          >
            {showPassword ? (
              <EyeOff aria-hidden className="size-4" />
            ) : (
              <Eye aria-hidden className="size-4" />
            )}
          </button>
        </div>
        <p className="text-caption text-fg-tertiary">{t("passwordHelper")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reset-confirm" className="text-body-ui font-medium text-fg">
          {t("confirmPassword")}
        </label>
        <input
          id="reset-confirm"
          name="confirmPassword"
          type={showPassword ? "text" : "password"}
          required
          minLength={10}
          autoComplete="new-password"
          className="h-9 w-full rounded-sm border border-edge-strong bg-base px-3 text-body-ui text-fg focus-visible:border-primary"
        />
      </div>

      <Button type="submit" loading={pending} className="w-full" size="lg">
        {pending ? t("resetSubmitting") : t("resetSubmit")}
      </Button>
    </form>
  );
}
