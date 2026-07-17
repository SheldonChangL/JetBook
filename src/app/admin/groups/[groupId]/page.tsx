import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { getGroup, listGroupMembers } from "@/lib/admin/groups";
import { listActiveUsers } from "@/lib/spaces/manage";
import { Avatar } from "@/components/ui/avatar";
import {
  AddGroupMemberForm,
  CsvImportForm,
  RemoveGroupMemberButton,
} from "./member-management";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ groupId: string }>;
}): Promise<Metadata> {
  const { groupId } = await params;
  const group = await getGroup(groupId);
  return { title: group?.name ?? "" };
}

/**
 * 群組成員管理詳情頁（K-03，F-ADMIN-02）。僅 org admin 可進；群組不存在或非 admin 一律 404。
 * 成員管理提供 Combobox 加人與 CSV 批次貼上 email 匯入。
 */
export default async function AdminGroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const { user } = await requireSession(`/admin/groups/${groupId}`);
  if (!isOrgAdmin(user)) notFound();

  const group = await getGroup(groupId);
  if (!group) notFound();

  const t = await getTranslations("adminGroups");
  const [members, candidates] = await Promise.all([
    listGroupMembers(groupId),
    listActiveUsers(),
  ]);
  const memberIds = new Set(members.map((m) => m.userId));
  const candidatesNotMembers = candidates.filter((c) => !memberIds.has(c.id));
  const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" });

  return (
    <div className="archive-admin-page archive-admin-group-detail mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="archive-admin-page-header flex flex-col gap-2">
        <Link
          href="/admin/groups"
          className="inline-flex w-fit items-center gap-1 text-caption text-fg-tertiary transition-colors hover:text-fg"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          {t("backToGroups")}
        </Link>
        <p className="archive-admin-kicker ui-archive-only">{t("archiveDetailKicker")}</p>
        <h1 className="text-h1 text-fg">{group.name}</h1>
        {group.description ? (
          <p className="text-body-ui text-fg-secondary">{group.description}</p>
        ) : null}
      </header>

      <section aria-labelledby="members-heading" className="archive-admin-section flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="members-heading" className="text-h4 text-fg">
              {t("membersHeading")}
            </h2>
            <p className="text-body-ui text-fg-secondary">{t("membersDesc")}</p>
          </div>
          <CsvImportForm groupId={groupId} />
        </div>

        <AddGroupMemberForm groupId={groupId} candidates={candidatesNotMembers} />

        {members.length === 0 ? (
          <p className="archive-admin-empty rounded-md border border-edge bg-raised px-4 py-6 text-center text-body-ui text-fg-tertiary">
            {t("emptyMembers")}
          </p>
        ) : (
          <div
            className="archive-admin-table-wrap overflow-x-auto rounded-md border border-edge"
            role="region"
            aria-label={t("membersHeading")}
            tabIndex={0}
          >
            <table className="archive-admin-table w-full text-body-ui">
              <thead>
                <tr className="border-b border-edge bg-sidebar text-left text-caption text-fg-tertiary">
                  <th className="px-3 py-2 font-medium">{t("colMember")}</th>
                  <th className="px-3 py-2 font-medium">{t("colJoinedAt")}</th>
                  <th className="px-3 py-2 font-medium">{t("colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId} className="border-b border-edge last:border-b-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <Avatar name={m.name} colorKey={m.userId} size="md" />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium text-fg">{m.name}</span>
                          <span className="truncate text-caption text-fg-tertiary">{m.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-fg-secondary">{dateFormat.format(m.createdAt)}</td>
                    <td className="px-3 py-2">
                      <RemoveGroupMemberButton groupId={groupId} userId={m.userId} name={m.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
