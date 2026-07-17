import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { getEditableSpaceIds } from "@/lib/authz/permission";
import { listTrashItems, TRASH_RETENTION_DAYS } from "@/lib/pages/trash";
import { relativeTime } from "@/lib/relative-time";
import { EmptyState } from "@/components/ui/empty-state";
import { TrashList, type TrashRow } from "@/components/trash/trash-list";

/**
 * 回收桶（C-08，F-PAGE-06）。
 * - 無 `?space` 參數：全域彙整——列出使用者有還原權限（editor+）的所有 space 已刪頁（C12）。
 * - `?space=<slug>`：單一 space 回收桶（space 側欄入口）；無還原權限即 404。
 * 權限一律經 lib/authz（getEditableSpaceIds）於 SQL 層限定範圍（架構鐵律 #1）。
 */
export default async function TrashPage({
  searchParams,
}: {
  searchParams: Promise<{ space?: string }>;
}) {
  const { space: spaceSlug } = await searchParams;
  const { user } = await requireSession(spaceSlug ? `/trash?space=${spaceSlug}` : "/trash");
  const t = await getTranslations("trash");
  const tCommon = await getTranslations("common");

  const editableSpaceIds = await getEditableSpaceIds(user);

  let scopedSpaceIds = editableSpaceIds;
  let scopedSpaceName: string | null = null;
  if (spaceSlug) {
    const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, spaceSlug) });
    if (!space || !editableSpaceIds.includes(space.id)) notFound();
    scopedSpaceIds = [space.id];
    scopedSpaceName = space.name;
  }

  const items = await listTrashItems(scopedSpaceIds);
  const now = new Date();

  const rows: TrashRow[] = items.map((item) => {
    const r = relativeTime(item.deletedAt, now);
    const deletedLabel =
      r.kind === "justNow"
        ? tCommon("relativeTime.justNow")
        : r.kind === "minutesAgo"
          ? tCommon("relativeTime.minutesAgo", { minutes: r.minutes })
          : r.kind === "hoursAgo"
            ? tCommon("relativeTime.hoursAgo", { hours: r.hours })
            : r.kind === "yesterday"
              ? tCommon("relativeTime.yesterday")
              : r.label;
    const elapsedDays = Math.floor((now.getTime() - item.deletedAt.getTime()) / 86_400_000);
    const daysLeft = Math.max(0, TRASH_RETENTION_DAYS - elapsedDays);
    return {
      pageId: item.pageId,
      title: item.title || t("emptyTitle"),
      icon: item.icon,
      spaceSlug: item.spaceSlug,
      spaceName: item.spaceName,
      spaceIcon: item.spaceIcon,
      deletedLabel,
      daysLeft,
      deleterName: item.deleterName,
      descendantCount: item.descendantCount,
    };
  });

  return (
    <div className="archive-trash-page mx-auto max-w-4xl px-6 py-8">
      <header className="archive-trash-header mb-6">
        <p className="archive-trash-kicker ui-archive-only">{t("archiveKicker")}</p>
        <h1 className="text-h1 text-fg">{t("title")}</h1>
        <p className="mt-1 text-body-ui text-fg-secondary">
          {scopedSpaceName ? t("subtitleSpace", { space: scopedSpaceName }) : t("subtitleGlobal")}
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
      ) : (
        <TrashList items={rows} showSpace={!spaceSlug} />
      )}
    </div>
  );
}
