import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { pages, pageVersions, spaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getCurrentSession, requireSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { denyPageRead } from "@/lib/authz/deny";
import { listPageVersions } from "@/actions/page";
import { RenderContent } from "@/components/content/render-content";
import { DiffContent, DiffEmpty, DiffLegend } from "@/components/content/diff-content";
import { diffDocs, isUnchanged } from "@/lib/content/diff";
import { RestoreVersionButton } from "./restore-version-button";
import { VersionSidebar, type VersionListItem } from "./version-sidebar";
import { Badge } from "@/components/ui/badge";
import type { ProseMirrorDoc } from "@/lib/content/types";
import { cn, decodeRouteParam } from "@/lib/utils";

const formatTime = (date: Date) =>
  new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(date);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceSlug: string; pageSlug: string }>;
}): Promise<Metadata> {
  const raw = await params;
  // route param 為 percent-encoded；含 CJK 的 slug 須還原才比對得到 DB（issue #207）
  const spaceSlug = decodeRouteParam(raw.spaceSlug);
  const pageSlug = decodeRouteParam(raw.pageSlug);
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

/** 讀取單一版本完整快照（含 content JSON）。 */
async function loadVersion(pageId: string, versionNo: number | null) {
  if (versionNo == null) return null;
  return db.query.pageVersions.findFirst({
    where: and(eq(pageVersions.pageId, pageId), eq(pageVersions.versionNo, versionNo)),
  });
}

/**
 * 版本歷史檢視（E-02 選版/唯讀渲染、E-03 還原、E-04 差異比較）。
 * 左欄時間軸列表＋勾選比較；右欄「快照」與「差異」兩 tab。
 */
export default async function PageHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceSlug: string; pageSlug: string }>;
  searchParams: Promise<{ v?: string; tab?: string; from?: string; to?: string }>;
}) {
  const raw = await params;
  const spaceSlug = decodeRouteParam(raw.spaceSlug);
  const pageSlug = decodeRouteParam(raw.pageSlug);
  const { v, tab, from, to } = await searchParams;
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

  // 還原鈕僅 editor+ 顯示（E-03）；判斷一律走 authz 唯一入口
  const canEdit = await can(user, "page.edit", { type: "page", spaceId: space.id });

  const versions = await listPageVersions(page.id);
  const versionItems: VersionListItem[] = versions.map((item) => ({
    id: item.id,
    versionNo: item.versionNo,
    note: item.note,
    authorName: item.authorName,
    createdAtMs: item.createdAt.getTime(),
  }));

  const readingHref = `/s/${spaceSlug}/${pageSlug}`;
  const base = `${readingHref}/history`;
  const activeTab: "snapshot" | "diff" = tab === "diff" ? "diff" : "snapshot";

  // 選中版本：?v=<versionNo>；無效或未指定則取最新
  const requested = Number.parseInt(v ?? "", 10);
  const selected = versions.find((item) => item.versionNo === requested) ?? versions[0] ?? null;

  // 差異比較配對：?from&?to（任兩版）優先，否則「與前版差異」（選中版 vs 前一版）
  let diffFromNo: number | null = null;
  let diffToNo: number | null = null;
  if (activeTab === "diff") {
    const fromNo = Number.parseInt(from ?? "", 10);
    const toNo = Number.parseInt(to ?? "", 10);
    const fromValid = versions.some((item) => item.versionNo === fromNo);
    const toValid = versions.some((item) => item.versionNo === toNo);
    if (fromValid && toValid && fromNo !== toNo) {
      diffFromNo = Math.min(fromNo, toNo);
      diffToNo = Math.max(fromNo, toNo);
    } else if (selected) {
      const idx = versions.findIndex((item) => item.versionNo === selected.versionNo);
      const older = versions[idx + 1] ?? null; // 新到舊排序：下一項為前一版
      diffToNo = selected.versionNo;
      diffFromNo = older ? older.versionNo : null;
    }
  }

  const snapshotVersionNo = selected?.versionNo ?? null;
  const snapshotTabHref = snapshotVersionNo != null ? `${base}?v=${snapshotVersionNo}` : base;
  const diffTabHref =
    snapshotVersionNo != null ? `${base}?v=${snapshotVersionNo}&tab=diff` : `${base}?tab=diff`;

  // 依模式載入所需版本內容（快照載選中版；差異載新舊兩版）
  const selectedFull =
    activeTab === "snapshot" ? await loadVersion(page.id, snapshotVersionNo) : null;
  const diffOld = activeTab === "diff" ? await loadVersion(page.id, diffFromNo) : null;
  const diffNew = activeTab === "diff" ? await loadVersion(page.id, diffToNo) : null;
  const diffEntries =
    activeTab === "diff" && diffToNo != null
      ? diffDocs(
          (diffOld?.content as ProseMirrorDoc | null) ?? null,
          (diffNew?.content as ProseMirrorDoc | null) ?? null,
        )
      : [];

  const tabClass = (isActive: boolean) =>
    cn(
      "-mb-px border-b-2 pb-2 text-body-ui transition-colors",
      isActive
        ? "border-primary font-medium text-fg"
        : "border-transparent text-fg-secondary hover:text-fg",
    );

  return (
    <div className="flex h-full min-h-0">
      {/* 左欄：版本列表（獨立捲動，§3.8）＋勾選比較 */}
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
        <VersionSidebar
          versions={versionItems}
          spaceSlug={spaceSlug}
          pageSlug={pageSlug}
          selectedVersionNo={snapshotVersionNo}
          activeTab={activeTab}
          compareFrom={diffFromNo ?? undefined}
          compareTo={diffToNo ?? undefined}
        />
      </aside>

      {/* 右欄：快照 / 差異 兩 tab */}
      <section className="min-w-0 flex-1 overflow-y-auto">
        {versions.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-body text-fg-tertiary">{t("empty")}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-6 py-8">
            <div className="mb-4 flex items-center gap-4 border-b border-edge">
              <Link href={snapshotTabHref} className={tabClass(activeTab === "snapshot")}>
                {t("tabSnapshot")}
              </Link>
              <Link href={diffTabHref} className={tabClass(activeTab === "diff")}>
                {t("tabDiff")}
              </Link>
            </div>

            {activeTab === "snapshot" ? (
              selected && selectedFull ? (
                <article>
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <p className="text-caption text-fg-tertiary">
                      {t("snapshotMeta", {
                        n: selected.versionNo,
                        time: formatTime(selected.createdAt),
                      })}
                    </p>
                    {canEdit ? (
                      <RestoreVersionButton
                        pageId={page.id}
                        versionNo={selected.versionNo}
                        readingHref={readingHref}
                      />
                    ) : null}
                  </div>
                  <h2 className="mb-6 text-h1 text-fg">{selectedFull.title}</h2>
                  <RenderContent
                    doc={(selectedFull.content as ProseMirrorDoc | null) ?? null}
                    embedAllowedDomains={env.EMBED_ALLOWED_DOMAINS}
                  />
                </article>
              ) : (
                <DiffEmpty>{t("empty")}</DiffEmpty>
              )
            ) : diffToNo == null ? (
              <DiffEmpty>{t("diffPickTwo")}</DiffEmpty>
            ) : diffFromNo == null ? (
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <Badge variant="primary">{t("versionLabel", { n: diffToNo })}</Badge>
                </div>
                <DiffEmpty>{t("diffNoPrevious")}</DiffEmpty>
              </div>
            ) : (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-caption text-fg-secondary">
                    {t("diffHeader", { from: diffFromNo, to: diffToNo })}
                  </p>
                  <DiffLegend />
                </div>
                {isUnchanged(diffEntries) ? (
                  <DiffEmpty>{t("diffUnchanged")}</DiffEmpty>
                ) : (
                  <DiffContent entries={diffEntries} />
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
