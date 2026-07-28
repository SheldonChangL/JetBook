import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import { listRecentlyUpdated, listRecentVisits } from "@/lib/pages/recent";
import { relativeTime } from "@/lib/relative-time";
import { BookOpen, PenLine, Search, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** 首次使用引導的三步（文案在 messages home.onboarding.*） */
const ONBOARDING_STEPS = [
  { key: "step1", Icon: Search },
  { key: "step2", Icon: PenLine },
  { key: "step3", Icon: Sparkles },
] as const;

/**
 * Dashboard（C-06，設計規範 §3.2）：繼續閱讀（page_visits 最近 6 筆）、
 * 最近更新（可讀頁面 updatedAt 倒序 8 筆）、我的空間。權限皆於 SQL 層過濾。
 */
export default async function HomePage() {
  const { user } = await requireSession("/");
  const t = await getTranslations("home");
  const tCommon = await getTranslations("common");
  const [spaces, visits, updates] = await Promise.all([
    listAccessibleSpaces(user),
    listRecentVisits(user),
    listRecentlyUpdated(user),
  ]);

  const now = new Date();
  const rel = (date: Date): string => {
    const r = relativeTime(date, now);
    switch (r.kind) {
      case "justNow":
        return tCommon("relativeTime.justNow");
      case "minutesAgo":
        return tCommon("relativeTime.minutesAgo", { minutes: r.minutes });
      case "hoursAgo":
        return tCommon("relativeTime.hoursAgo", { hours: r.hours });
      case "yesterday":
        return tCommon("relativeTime.yesterday");
      case "date":
        return r.label;
    }
  };

  return (
    <div className="archive-dashboard mx-auto flex max-w-4xl flex-col gap-8 px-6 py-8">
      <header className="archive-dashboard-header">
        <p className="archive-dashboard-kicker">{t("archiveKicker")}</p>
        <h1 className="text-h1 text-fg">{t("greeting", { name: user.name })}</h1>
        <p className="mt-1 text-body-ui text-fg-secondary">
          {t("archiveSubtitle")}
        </p>
      </header>

      {/* 首次使用（尚無瀏覽紀錄）：先給上手三步與 AI 助理接入入口，而非空白清單 */}
      {visits.length === 0 && (
        <section
          className="archive-dashboard-onboarding flex flex-col gap-4 rounded-md border border-edge bg-raised p-5"
          aria-label={t("onboarding.heading")}
        >
          <div>
            <h2 className="text-h3 text-fg">{t("onboarding.heading")}</h2>
            <p className="mt-1 text-body-ui text-fg-secondary">{t("onboarding.body")}</p>
          </div>
          <ol className="grid gap-3 sm:grid-cols-3">
            {ONBOARDING_STEPS.map(({ key, Icon }) => (
              <li key={key} className="flex flex-col gap-1 rounded-md border border-edge p-4">
                <p className="flex items-center gap-2 text-body-ui font-medium text-fg">
                  <Icon aria-hidden className="size-4 text-fg-tertiary" />
                  {t(`onboarding.${key}Title`)}
                </p>
                <p className="text-caption text-fg-secondary">{t(`onboarding.${key}Body`)}</p>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/guide"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-body-ui text-on-primary transition-colors hover:bg-primary-hover"
            >
              <BookOpen aria-hidden className="size-4" />
              {t("onboarding.guideCta")}
            </Link>
            <Link
              href="/guide#mcp"
              className="inline-flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-body-ui text-fg transition-colors hover:bg-hover"
            >
              <Sparkles aria-hidden className="size-4" />
              {t("onboarding.mcpCta")}
            </Link>
          </div>
        </section>
      )}

      <section className="archive-dashboard-section" aria-label={t("continueReading")}>
        <h2 className="mb-3 text-h3 text-fg">{t("continueReading")}</h2>
        {visits.length === 0 ? (
          <p className="text-body-ui text-fg-tertiary">{t("noVisits")}</p>
        ) : (
          <ul className="archive-dashboard-reading grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visits.map((v) => (
              <li key={v.pageId}>
                <Link
                  href={`/s/${v.spaceSlug}/${v.slug}`}
                  className="archive-dashboard-reading-row flex flex-col gap-1 rounded-md border border-edge bg-raised p-4 transition-colors hover:border-edge-strong hover:bg-hover"
                >
                  <span className="truncate text-body-ui font-medium text-fg">
                    {v.icon ? `${v.icon} ` : ""}
                    {v.title}
                  </span>
                  <span className="truncate text-caption text-fg-tertiary">{v.spaceName}</span>
                  <span className="text-caption text-fg-tertiary">{rel(v.visitedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="archive-dashboard-section" aria-label={t("recentUpdates")}>
        <h2 className="mb-3 text-h3 text-fg">{t("recentUpdates")}</h2>
        {updates.length === 0 ? (
          <p className="text-body-ui text-fg-tertiary">{t("noRecentUpdates")}</p>
        ) : (
          <ul className="archive-dashboard-updates flex flex-col divide-y divide-edge rounded-md border border-edge bg-raised">
            {updates.map((u) => (
              <li key={u.pageId} className="flex min-w-0 items-center gap-2 px-4 py-3">
                {u.updatedByName ? (
                  <span className="shrink-0 text-body-ui text-fg-secondary">
                    {t("updatedBy", { name: u.updatedByName })}
                  </span>
                ) : null}
                <Link
                  href={`/s/${u.spaceSlug}/${u.slug}`}
                  className="truncate text-body-ui font-medium text-fg hover:text-primary"
                >
                  {u.icon ? `${u.icon} ` : ""}
                  {u.title}
                </Link>
                <Badge variant="neutral" className="shrink-0">
                  {u.spaceName}
                </Badge>
                <span className="ml-auto shrink-0 text-caption text-fg-tertiary">
                  {rel(u.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="archive-dashboard-section" aria-label={t("mySpaces")}>
        <h2 className="mb-3 text-h3 text-fg">{t("mySpaces")}</h2>
        {spaces.length === 0 ? (
          <p className="text-body-ui text-fg-tertiary">{t("noSpaces")}</p>
        ) : (
          <ul className="archive-dashboard-spaces grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {spaces.slice(0, 6).map((s) => (
              <li key={s.id}>
                <Link
                  href={`/s/${s.slug}`}
                  className="archive-dashboard-space-row flex flex-col gap-1 rounded-md border border-edge bg-raised p-4 transition-shadow hover:shadow-sm"
                >
                  <span className="text-h4 text-fg">
                    {s.icon ? `${s.icon} ` : ""}
                    {s.name}
                  </span>
                  <Badge variant={s.visibility === "private" ? "neutral" : "primary"}>
                    {t(`visibility.${s.visibility}`)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
