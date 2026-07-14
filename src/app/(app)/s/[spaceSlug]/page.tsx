import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { ExternalLink, Settings } from "lucide-react";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { getSpaceRole } from "@/lib/authz/permission";
import { listSpaceTreeNodes } from "@/lib/pages/tree";
import { decodeRouteParam } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Space 首頁（C-03）：描述＋頂層頁面目錄卡片（標題＋子頁數，設計規範 §3.3 ③）。
 */
export default async function SpaceHomePage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  // route param 為 percent-encoded；含 CJK 的 slug 須還原才比對得到 DB（issue #207）
  const spaceSlug = decodeRouteParam((await params).spaceSlug);
  const { user } = await requireSession(`/s/${spaceSlug}`);

  const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, spaceSlug) });
  if (!space || space.deletedAt) notFound();

  const role = await getSpaceRole(user, space.id);
  if (!role) notFound();

  const t = await getTranslations("spaceHome");
  const nodes = await listSpaceTreeNodes(space.id);
  const topLevel = nodes.filter((n) => n.parentId === null);
  const childCount = new Map<string, number>();
  for (const n of nodes) {
    if (n.parentId) childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1);
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-h1 text-fg">
            {space.icon ? `${space.icon} ` : ""}
            {space.name}
          </h1>
          {role === "admin" ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/s/${space.slug}/settings`}>
                <Settings aria-hidden className="size-4" />
                {t("settingsLink")}
              </Link>
            </Button>
          ) : null}
        </div>
        {space.description ? (
          <p className="text-body-read text-fg-secondary">{space.description}</p>
        ) : null}
      </header>

      <section aria-label={t("pagesHeading")} className="flex flex-col gap-3">
        <h2 className="text-h4 text-fg">{t("pagesHeading")}</h2>
        {topLevel.length === 0 ? (
          <p className="text-body-ui text-fg-tertiary">{t("noPages")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {topLevel.map((n) => {
              // 外部連結卡片：新分頁開啟目標 URL（C-11）。
              if (n.kind === "external_link") {
                return (
                  <a
                    key={n.id}
                    href={n.externalUrl ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col gap-1 rounded-md border border-edge bg-raised p-4 transition-colors hover:border-edge-strong hover:bg-hover"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-body-ui font-medium text-fg">
                      <span className="truncate">
                        {n.icon ? `${n.icon} ` : ""}
                        {n.title}
                      </span>
                      <ExternalLink aria-hidden className="size-3.5 shrink-0 text-fg-tertiary" />
                    </span>
                    <span className="truncate text-caption text-fg-tertiary">{n.externalUrl}</span>
                  </a>
                );
              }
              // 群組分節：不可開啟，僅顯示為分節卡片（C-11）。
              if (n.kind === "group") {
                return (
                  <div
                    key={n.id}
                    className="flex flex-col gap-1 rounded-md border border-dashed border-edge bg-base p-4"
                  >
                    <span className="truncate text-body-ui font-semibold text-fg-secondary">
                      {n.icon ? `${n.icon} ` : ""}
                      {n.title}
                    </span>
                    <span className="text-caption text-fg-tertiary">
                      {t("childCount", { count: childCount.get(n.id) ?? 0 })}
                    </span>
                  </div>
                );
              }
              return (
                <Link
                  key={n.id}
                  href={`/s/${space.slug}/${n.slug}`}
                  className="flex flex-col gap-1 rounded-md border border-edge bg-raised p-4 transition-colors hover:border-edge-strong hover:bg-hover"
                >
                  <span className="truncate text-body-ui font-medium text-fg">
                    {n.icon ? `${n.icon} ` : ""}
                    {n.title}
                  </span>
                  <span className="text-caption text-fg-tertiary">
                    {t("childCount", { count: childCount.get(n.id) ?? 0 })}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
