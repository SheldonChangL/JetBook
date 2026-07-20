import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { isOidcEnabled } from "@/lib/auth/oidc";
import { AuthFrame } from "@/components/layout/auth-frame";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("loginTitle") };
}

/** 登入頁（設計規範 §3.1）：全螢幕置中 400px 卡片，無 App Shell。 */
export default async function LoginPage() {
  const tAuth = await getTranslations("auth");

  return (
    <AuthFrame title={tAuth("loginTitle")}>
      <Suspense>
        <LoginForm oidcEnabled={isOidcEnabled()} />
      </Suspense>
    </AuthFrame>
  );
}
