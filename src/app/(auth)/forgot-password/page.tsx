import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getUiVersion } from "@/lib/ui-version-server";
import { AuthFrame } from "@/components/layout/auth-frame";
import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("forgotTitle") };
}

/** 忘記密碼頁（設計規範 §3.1）：與登入頁同樣式的置中 400px 卡片。 */
export default async function ForgotPasswordPage() {
  const tAuth = await getTranslations("auth");
  const uiVersion = await getUiVersion();

  return (
    <AuthFrame uiVersion={uiVersion} title={tAuth("forgotTitle")}>
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
