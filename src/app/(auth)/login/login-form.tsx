"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { login, type LoginState } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const initialState: LoginState = { status: "idle" };

export function LoginForm() {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(login, initialState);
  const [showPassword, setShowPassword] = useState(false);

  const errorMessage =
    state.status !== "error"
      ? null
      : state.code === "locked"
        ? t("errorLockedFor", { seconds: state.retryAfterSeconds })
        : state.code === "rateLimited"
          ? t("errorRateLimited")
          : t("errorInvalidCredentials");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {errorMessage ? (
        <div
          role="alert"
          className="rounded-sm border border-danger/30 bg-danger-tint px-3 py-2 text-body-ui text-danger"
        >
          {errorMessage}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-email" className="text-body-ui font-medium text-fg">
          {t("email")}
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="h-9 w-full rounded-sm border border-edge-strong bg-base px-3 text-body-ui text-fg placeholder:text-fg-tertiary focus-visible:border-primary"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-password" className="text-body-ui font-medium text-fg">
          {t("password")}
        </label>
        <div className="relative">
          <input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
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
      </div>

      <label className={cn("flex select-none items-center gap-2 text-body-ui text-fg-secondary")}>
        <input type="checkbox" name="remember" value="true" className="size-4 accent-primary" />
        {t("rememberMe")}
      </label>

      <Button type="submit" loading={pending} className="w-full" size="lg">
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
