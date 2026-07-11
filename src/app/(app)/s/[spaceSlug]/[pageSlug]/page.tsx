import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { History, Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getCurrentSession, requireSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { denyPageRead } from "@/lib/authz/deny";
import { recordVisit } from "@/lib/pages/visits";
import { resolvePageBySlug } from "@/lib/pages/slug";
import { listPageComments } from "@/lib/comments/service";
import { RenderContent } from "@/components/content/render-content";
import { CopyLinkButton } from "@/components/content/copy-link-button";
import { AnchorHighlight } from "@/components/content/anchor-highlight";
import { Button } from "@/components/ui/button";
import type { ProseMirrorDoc } from "@/lib/content/types";
import { CommentsPanel } from "./comments-panel";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceSlug: string; pageSlug: string }>;
}): Promise<Metadata> {
  const { spaceSlug, pageSlug } = await params;
  // 權限檢查同頁面本體：無權限者連 <title> 都不得洩漏頁面存在性（G-04 §3.12）。
  const session = await getCurrentSession();
  if (!session) return {};
  const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, spaceSlug) });
  if (!space) return {};
  if (!(await can(session.user, "page.read", { type: "page", spaceId: space.id }))) return {};
  const { page } = await resolvePageBySlug(space.id, pageSlug);
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

  const { page, redirectToSlug } = await resolvePageBySlug(space.id, pageSlug);
  if (redirectToSlug) redirect(`/s/${spaceSlug}/${redirectToSlug}`);
  if (!page) notFound();

  // 無權限但頁面存在：private Space 一律 404（不洩漏存在性）；org 可見 Space 導 403（§3.12）。
  if (!(await can(user, "page.read", { type: "page", spaceId: space.id }))) {
    denyPageRead(space, `/s/${spaceSlug}/${pageSlug}`);
  }
  await recordVisit(user.id, page.id);

  const canEdit = await can(user, "page.edit", { type: "page", spaceId: space.id });
  // 留言區（K-01）：commenter+ 可留言、space admin 可刪除他人留言。
  const canComment = await can(user, "page.comment", { type: "page", spaceId: space.id });
  const canModerate = await can(user, "space.manage", { type: "space", spaceId: space.id });
  const comments = await listPageComments(page.id);
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
        <div className="flex shrink-0 items-center gap-1.5">
          <CopyLinkButton />
          <Button asChild variant="ghost" size="sm">
            <Link href={`/s/${spaceSlug}/${pageSlug}/history`}>
              <History aria-hidden className="size-4" />
              {t("history")}
            </Link>
          </Button>
          {canEdit ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/s/${spaceSlug}/${pageSlug}/edit`}>
                <Pencil aria-hidden className="size-4" />
                {t("edit")}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <p className="mb-6 text-caption text-fg-tertiary">{t("lastUpdated", { time: updated })}</p>

      <RenderContent
        doc={(page.content as ProseMirrorDoc | null) ?? null}
        embedAllowedDomains={env.EMBED_ALLOWED_DOMAINS}
      />
      <AnchorHighlight />

      <CommentsPanel
        pageId={page.id}
        currentUser={{ id: user.id, name: user.name }}
        canComment={canComment}
        canModerate={canModerate}
        initialComments={comments}
      />
    </article>
  );
}
