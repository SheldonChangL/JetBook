import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { validatePasswordResetToken } from "@/lib/auth/password-reset";
import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("resetTitle") };
}

/**
 * 重設密碼頁（設計規範 §3.1）：讀 ?token= 於伺服端先驗證，
 * 有效才顯示表單；無效／過期顯示錯誤與重新申請連結（不消費 token）。
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const tCommon = await getTranslations("common");
  const tAuth = await getTranslations("auth");
  const { token } = await searchParams;
  const valid = token ? await validatePasswordResetToken(token) : null;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-[400px] rounded-lg border border-edge bg-raised p-8 shadow-lg">
        <div className="mb-6 flex flex-col items-center gap-1">
          <h1 className="text-h2 text-fg">{tCommon("appName")}</h1>
          <p className="text-caption text-fg-tertiary">{tAuth("resetTitle")}</p>
        </div>
        {valid && token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="flex flex-col gap-4">
            <div
              role="alert"
              className="rounded-sm border border-danger/30 bg-danger-tint px-3 py-2 text-body-ui text-danger"
            >
              {tAuth("resetTokenInvalid")}
            </div>
            <Link
              href="/forgot-password"
              className="text-center text-body-ui text-primary hover:underline"
            >
              {tAuth("resetRequestAgain")}
            </Link>
          </div>
        )}
      </div>
      <p className="mt-6 text-caption text-fg-tertiary">{tAuth("copyright")}</p>
    </main>
  );
}
