import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { listGroups } from "@/lib/admin/groups";
import { CreateGroupButton } from "./create-group-button";
import { GroupRowActions } from "./group-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups");
  return { title: t("title") };
}

/**
 * 使用者群組管理列表（K-03，F-ADMIN-02）。僅 org admin 可進；非 admin 一律 404。
 * 成員管理（Combobox 加人、CSV 匯入）於 /admin/groups/[groupId] 詳情頁。
 */
export default async function AdminGroupsPage() {
  const { user } = await requireSession("/admin/groups");
  if (!isOrgAdmin(user)) notFound();
  const t = await getTranslations("adminGroups");
  const list = await listGroups();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 text-fg">{t("title")}</h1>
          <p className="text-body-ui text-fg-secondary">{t("desc")}</p>
        </div>
        <CreateGroupButton />
      </header>

      {list.length === 0 ? (
        <p className="rounded-md border border-edge bg-raised px-4 py-6 text-center text-body-ui text-fg-tertiary">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-edge">
          <table className="w-full text-body-ui">
            <thead>
              <tr className="border-b border-edge bg-sidebar text-left text-caption text-fg-tertiary">
                <th className="px-3 py-2 font-medium">{t("colName")}</th>
                <th className="px-3 py-2 font-medium">{t("colDescription")}</th>
                <th className="px-3 py-2 font-medium">{t("colMemberCount")}</th>
                <th className="px-3 py-2 font-medium">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.id} className="border-b border-edge last:border-b-0">
                  <td className="px-3 py-2 font-medium text-fg">
                    <Link href={`/admin/groups/${g.id}`} className="hover:text-primary">
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">{g.description ?? "—"}</td>
                  <td className="px-3 py-2 text-fg-secondary">
                    {t("memberCount", { count: g.memberCount })}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/groups/${g.id}`}
                        className="text-caption text-primary hover:underline"
                      >
                        {t("manageMembers")}
                      </Link>
                      <GroupRowActions
                        groupId={g.id}
                        name={g.name}
                        description={g.description}
                      />
                    </div>
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
