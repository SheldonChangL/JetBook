import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("forgotTitle") };
}

/** 忘記密碼頁（設計規範 §3.1）：與登入頁同樣式的置中 400px 卡片。 */
export default async function ForgotPasswordPage() {
  const tCommon = await getTranslations("common");
  const tAuth = await getTranslations("auth");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-[400px] rounded-lg border border-edge bg-raised p-8 shadow-lg">
        <div className="mb-6 flex flex-col items-center gap-1">
          <h1 className="text-h2 text-fg">{tCommon("appName")}</h1>
          <p className="text-caption text-fg-tertiary">{tAuth("forgotTitle")}</p>
        </div>
        <ForgotPasswordForm />
      </div>
      <p className="mt-6 text-caption text-fg-tertiary">{tAuth("copyright")}</p>
    </main>
  );
}
