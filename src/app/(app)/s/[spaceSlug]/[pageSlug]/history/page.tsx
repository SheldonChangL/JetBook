import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { pages, pageVersions, spaces } from "@/lib/db/schema";
import { getCurrentSession, requireSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { denyPageRead } from "@/lib/authz/deny";
import { listPageVersions } from "@/actions/page";
import { RenderContent } from "@/components/content/render-content";
import { Badge } from "@/components/ui/badge";
import type { ProseMirrorDoc } from "@/lib/content/types";
import { cn } from "@/lib/utils";

const formatTime = (date: Date) =>
  new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(date);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceSlug: string; pageSlug: string }>;
}): Promise<Metadata> {
  const { spaceSlug, pageSlug } = await params;
  // 權限檢查同閱讀頁：無權限者連 <title> 都不得洩漏頁面存在性（§3.12）
  const session = await getCurrentSession();
  if (!session) return {};
  const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, spaceSlug) });
  if (!space) return {};
  if (!(await can(session.user, "page.read", { type: "page", spaceId: space.id }))) return {};
  const page = await db.query.pages.findFirst({
    where: and(eq(pages.spaceId, space.id), eq(pages.slug, pageSlug), isNull(pages.deletedAt)),
  });
  if (!page) return {};
  const t = await getTranslations("versionHistory");
  return { title: t("metaTitle", { title: page.title }) };
}

/** 版本歷史檢視（E-02，設計規範 §3.8）：左欄時間軸列表＋右欄快照唯讀渲染。 */
export default async function PageHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceSlug: string; pageSlug: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { spaceSlug, pageSlug } = await params;
  const { v } = await searchParams;
  const { user } = await requireSession(`/s/${spaceSlug}/${pageSlug}/history`);
  const t = await getTranslations("versionHistory");

  const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, spaceSlug) });
  if (!space) notFound();
  const page = await db.query.pages.findFirst({
    where: and(eq(pages.spaceId, space.id), eq(pages.slug, pageSlug), isNull(pages.deletedAt)),
  });
  if (!page) notFound();

  // 無權限：private Space 一律 404（不洩漏存在性）；org 可見 Space 導 403（§3.12）
  if (!(await can(user, "page.read", { type: "page", spaceId: space.id }))) {
    denyPageRead(space, `/s/${spaceSlug}/${pageSlug}/history`);
  }

  const versions = await listPageVersions(page.id);

  // 選中版本：?v=<versionNo>；無效或未指定則取最新
  const requested = Number.parseInt(v ?? "", 10);
  const selected = versions.find((item) => item.versionNo === requested) ?? versions[0] ?? null;
  // 列表 select 不含完整 content（避免整批快照 JSON 進列表查詢），選中版單獨取
  const selectedFull = selected
    ? await db.query.pageVersions.findFirst({
        where: and(eq(pageVersions.pageId, page.id), eq(pageVersions.versionNo, selected.versionNo)),
      })
    : null;

  const readingHref = `/s/${spaceSlug}/${pageSlug}`;

  return (
    <div className="flex h-full min-h-0">
      {/* 左欄：版本列表（獨立捲動，§3.8） */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-edge">
        <div className="border-b border-edge px-4 py-3">
          <Link
            href={readingHref}
            className="mb-2 inline-flex items-center gap-1 text-caption text-fg-tertiary transition-colors hover:text-fg"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            {t("backToReading")}
          </Link>
          <h1 className="text-body-ui font-semibold text-fg">
            {t("title", { count: versions.length })}
          </h1>
          <p className="truncate text-caption text-fg-tertiary">{page.title}</p>
        </div>
        <nav aria-label={t("listLabel")} className="min-h-0 flex-1 overflow-y-auto py-2">
          {versions.length === 0 ? (
            <p className="px-4 py-6 text-caption text-fg-tertiary">{t("empty")}</p>
          ) : (
            <ul className="flex flex-col">
              {versions.map((item) => {
                const isSelected = item.versionNo === selected?.versionNo;
                return (
                  <li key={item.id}>
                    <Link
                      href={`${readingHref}/history?v=${item.versionNo}`}
                      aria-current={isSelected ? "true" : undefined}
                      className={cn(
                        "block border-l-2 px-4 py-2.5 transition-colors",
                        isSelected
                          ? "border-primary bg-primary-tint"
                          : "border-transparent hover:bg-hover",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-body-ui font-medium text-fg">
                          {t("versionLabel", { n: item.versionNo })}
                        </span>
                        {item.note ? (
                          <Badge variant="primary">{item.note}</Badge>
                        ) : (
                          <Badge variant="neutral">{t("autoSnapshot")}</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-caption text-fg-secondary">
                        {item.authorName ?? t("unknownAuthor")}
                      </p>
                      <p className="text-caption text-fg-tertiary">{formatTime(item.createdAt)}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>

      {/* 右欄：選中版本唯讀渲染 */}
      <section className="min-w-0 flex-1 overflow-y-auto">
        {selected && selectedFull ? (
          <article className="mx-auto max-w-3xl px-6 py-8">
            <p className="mb-2 text-caption text-fg-tertiary">
              {t("snapshotMeta", {
                n: selected.versionNo,
                time: formatTime(selected.createdAt),
              })}
            </p>
            <h2 className="mb-6 text-h1 text-fg">{selectedFull.title}</h2>
            <RenderContent doc={(selectedFull.content as ProseMirrorDoc | null) ?? null} />
          </article>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-body text-fg-tertiary">{t("empty")}</p>
          </div>
        )}
      </section>
    </div>
  );
}
