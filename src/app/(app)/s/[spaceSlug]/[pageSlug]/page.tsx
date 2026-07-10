import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { pages, pageSlugHistory, spaces } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { recordVisit } from "@/lib/pages/visits";
import { RenderContent } from "@/components/content/render-content";
import { Button } from "@/components/ui/button";
import type { ProseMirrorDoc } from "@/lib/content/types";

async function resolvePage(spaceId: string, spaceSlug: string, pageSlug: string) {
  const page = await db.query.pages.findFirst({
    where: and(eq(pages.spaceId, spaceId), eq(pages.slug, pageSlug), isNull(pages.deletedAt)),
  });
  if (page) return { page, redirectTo: null as string | null };
  // 舊 slug → 301 導向現行 slug（G1/F-PAGE-03）
  const history = await db.query.pageSlugHistory.findFirst({
    where: and(eq(pageSlugHistory.spaceId, spaceId), eq(pageSlugHistory.oldSlug, pageSlug)),
  });
  if (history) {
    const current = await db.query.pages.findFirst({
      where: and(eq(pages.id, history.pageId), isNull(pages.deletedAt)),
    });
    if (current) return { page: null, redirectTo: `/s/${spaceSlug}/${current.slug}` };
  }
  return { page: null, redirectTo: null };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceSlug: string; pageSlug: string }>;
}): Promise<Metadata> {
  const { spaceSlug, pageSlug } = await params;
  const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, spaceSlug) });
  if (!space) return {};
  const { page } = await resolvePage(space.id, spaceSlug, pageSlug);
  return { title: page?.title };
}

/** 文件閱讀頁（G-02，設計規範 §3.4）。 */
export default async function PageReadPage({
  params,
}: {
  params: Promise<{ spaceSlug: string; pageSlug: string }>;
}) {
  const { spaceSlug, pageSlug } = await params;
  const { user } = await requireSession(`/s/${spaceSlug}/${pageSlug}`);
  const t = await getTranslations("reading");

  const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, spaceSlug) });
  if (!space) notFound();

  const { page, redirectTo } = await resolvePage(space.id, spaceSlug, pageSlug);
  if (redirectTo) redirect(redirectTo);
  if (!page) notFound();

  if (!(await can(user, "page.read", { type: "page", spaceId: space.id }))) notFound();
  await recordVisit(user.id, page.id);

  const canEdit = await can(user, "page.edit", { type: "page", spaceId: space.id });
  const updated = new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(page.updatedAt);

  return (
    <article className="mx-auto max-w-3xl px-6 py-8">
      <nav className="mb-2 text-caption text-fg-tertiary">
        <Link href={`/s/${spaceSlug}`} className="hover:text-fg">
          {space.icon ? `${space.icon} ` : ""}
          {space.name}
        </Link>
      </nav>

      <div className="mb-1 flex items-start justify-between gap-4">
        <h1 className="text-h1 text-fg">
          {page.icon ? `${page.icon} ` : ""}
          {page.title}
        </h1>
        {canEdit ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={`/s/${spaceSlug}/${pageSlug}/edit`}>
              <Pencil aria-hidden className="size-4" />
              {t("edit")}
            </Link>
          </Button>
        ) : null}
      </div>

      <p className="mb-6 text-caption text-fg-tertiary">{t("lastUpdated", { time: updated })}</p>

      <RenderContent doc={(page.content as ProseMirrorDoc | null) ?? null} />
    </article>
  );
}
