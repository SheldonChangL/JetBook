import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/current";
import type { Theme } from "@/lib/theme";
import { ProfileSection } from "./profile-section";
import { PasswordSection } from "./password-section";
import { AppearanceSection } from "./appearance-section";
import { NotificationsSection } from "./notifications-section";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

/**
 * 個人設定頁（B-08，設計規範 §3 個人設定）：三區——基本資料（顯示名稱）、
 * 變更密碼（本地帳號）、外觀偏好。薄殼：驗 session 後將資料交由各區塊 client 元件。
 */
export default async function SettingsPage() {
  const { user } = await requireSession("/settings");
  const t = await getTranslations("settings");

  const currentTheme: Theme =
    user.themePreference === "light" || user.themePreference === "dark"
      ? user.themePreference
      : "system";

  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-8 px-6 py-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1 text-caption text-fg-tertiary transition-colors hover:text-fg"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          {t("backToApp")}
        </Link>
        <h1 className="text-h1 text-fg">{t("title")}</h1>
        <p className="text-body-ui text-fg-secondary">{t("subtitle")}</p>
      </header>

      <ProfileSection name={user.name} email={user.email} />

      <PasswordSection isLocal={user.authProvider === "local" && user.passwordHash !== null} />

      <AppearanceSection initialTheme={currentTheme} />

      <NotificationsSection initialPrefs={user.emailNotificationPrefs ?? null} />
    </main>
  );
}
