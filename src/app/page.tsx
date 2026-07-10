import { getTranslations } from "next-intl/server";

export default async function HomePage() {
  const t = await getTranslations("home");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-base px-6">
      <h1 className="text-h1 text-fg">{t("title")}</h1>
      <p className="text-body-ui text-fg-secondary">{t("subtitle")}</p>
      <span className="rounded-xs bg-primary-tint px-2 py-0.5 text-caption text-primary">
        {t("stageBadge")}
      </span>
    </main>
  );
}
