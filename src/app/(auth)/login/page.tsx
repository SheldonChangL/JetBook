import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentSession } from "@/lib/auth/current";
import { isOidcEnabled } from "@/lib/auth/oidc";
import { AuthFrame } from "@/components/layout/auth-frame";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("loginTitle") };
}

/** 登入頁（設計規範 §3.1）：全螢幕置中 400px 卡片，無 App Shell。 */
export default async function LoginPage() {
  // 已登入者導回首頁（issue #273）：以真實 session 驗證，不靠 middleware 的 cookie 存在性快篩——
  // 殘留的無效 cookie 必須看到登入表單，否則會與 requireSession 的 redirect("/login") 互推成迴圈。
  if (await getCurrentSession()) redirect("/");

  const tAuth = await getTranslations("auth");

  return (
    <AuthFrame title={tAuth("loginTitle")}>
      <Suspense>
        <LoginForm oidcEnabled={isOidcEnabled()} />
      </Suspense>
    </AuthFrame>
  );
}
