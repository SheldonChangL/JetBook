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
import { ApiTokensSection } from "./api-tokens-section";
import { listApiTokens } from "@/lib/api-tokens";

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
  const apiTokens = await listApiTokens(user.id);

  const currentTheme: Theme =
    user.themePreference === "light" || user.themePreference === "dark"
      ? user.themePreference
      : "system";

  return (
    <main className="archive-personal-settings mx-auto flex max-w-[720px] flex-col gap-8 px-6 py-8">
      <header className="archive-personal-header flex flex-col gap-2">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1 text-caption text-fg-tertiary transition-colors hover:text-fg"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          {t("backToApp")}
        </Link>
        <p className="archive-personal-kicker">{t("archiveKicker")}</p>
        <h1 className="text-h1 text-fg">{t("title")}</h1>
        <p className="text-body-ui text-fg-secondary">{t("subtitle")}</p>
      </header>

      <div className="archive-personal-layout">
        <nav className="archive-personal-nav" aria-label={t("archiveNavLabel")}>
          <ul>
            <li><a href="#profile">{t("profileHeading")}</a></li>
            <li><a href="#password">{t("passwordHeading")}</a></li>
            <li><a href="#appearance">{t("appearanceHeading")}</a></li>
            <li><a href="#notifications">{t("notificationsHeading")}</a></li>
            <li><a href="#api-tokens">{t("apiTokens.heading")}</a></li>
          </ul>
        </nav>

        <div className="archive-personal-content">
          <ProfileSection name={user.name} email={user.email} />

          <PasswordSection isLocal={user.authProvider === "local" && user.passwordHash !== null} />

          <AppearanceSection initialTheme={currentTheme} />

          <NotificationsSection initialPrefs={user.emailNotificationPrefs ?? null} />

          <ApiTokensSection
            tokens={apiTokens.map((token) => ({
              id: token.id,
              name: token.name,
              scopes: token.scopes,
              expiresAt: token.expiresAt?.toISOString() ?? null,
              lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
              createdAt: token.createdAt.toISOString(),
            }))}
          />
        </div>
      </div>
    </main>
  );
}
