import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { listDeletedSpaces, SPACE_TRASH_RETENTION_DAYS } from "@/lib/spaces/manage";
import { EmptyState } from "@/components/ui/empty-state";
import { RestoreSpaceButton } from "./restore-space-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("spacesTitle") };
}

/** 剩餘可還原天數（無條件進位，至少 1）：保留期 − 已刪除天數。 */
function daysLeft(deletedAt: Date): number {
  const elapsedMs = Date.now() - deletedAt.getTime();
  const remaining = SPACE_TRASH_RETENTION_DAYS - Math.floor(elapsedMs / 86_400_000);
  return Math.max(1, remaining);
}

/**
 * 後台「已刪除空間」（C-12，F-ORG-04）：列出保留期內的軟刪空間，org admin 可還原。
 * layout 已擋，page 再驗一次（防 soft navigation 繞過）。
 */
export default async function AdminSpacesPage() {
  const { user } = await requireSession("/admin/spaces");
  if (!isOrgAdmin(user)) notFound();
  const t = await getTranslations("admin");
  const list = await listDeletedSpaces();
  const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="archive-admin-page archive-admin-spaces mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="archive-admin-page-header flex flex-col gap-1">
        <p className="archive-admin-kicker ui-archive-only">{t("archiveSpacesKicker")}</p>
        <h1 className="text-h1 text-fg">{t("spacesTitle")}</h1>
        <p className="text-body-ui text-fg-secondary">{t("spacesDesc")}</p>
      </header>

      {list.length === 0 ? (
        <EmptyState title={t("spacesEmpty")} />
      ) : (
        <div
          className="archive-admin-table-wrap overflow-x-auto rounded-md border border-edge"
          role="region"
          aria-label={t("spacesTitle")}
          tabIndex={0}
        >
          <table className="archive-admin-table w-full text-body-ui">
            <thead>
              <tr className="border-b border-edge bg-sidebar text-left text-caption text-fg-tertiary">
                <th className="px-3 py-2 font-medium">{t("spacesColSpace")}</th>
                <th className="px-3 py-2 font-medium">{t("spacesColDeletedAt")}</th>
                <th className="px-3 py-2 font-medium">{t("spacesColDaysLeft")}</th>
                <th className="px-3 py-2 font-medium">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((space) => (
                <tr key={space.id} className="border-b border-edge last:border-b-0">
                  <td className="px-3 py-2 font-medium text-fg">
                    {space.icon ? `${space.icon} ` : ""}
                    {space.name}
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">
                    {dateFormat.format(space.deletedAt)}
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">
                    {t("spacesDaysLeft", { days: daysLeft(space.deletedAt) })}
                  </td>
                  <td className="px-3 py-2">
                    <RestoreSpaceButton spaceId={space.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
