import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { listUsers } from "@/lib/admin/users";
import { Badge } from "@/components/ui/badge";
import { CreateUserButton } from "./create-user-button";
import { ActiveToggle, OrgRoleSelect, ResetPasswordButton } from "./user-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("usersTitle") };
}

export default async function AdminUsersPage() {
  // layout 已擋，但 page 再驗一次（防 soft navigation 繞過；session 查詢有 React cache）
  const { user } = await requireSession("/admin/users");
  if (!isOrgAdmin(user)) notFound();
  const t = await getTranslations("admin");
  const list = await listUsers();
  const dateFormat = new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-h1 text-fg">{t("usersTitle")}</h1>
        <CreateUserButton />
      </header>

      <div className="overflow-x-auto rounded-md border border-edge">
        <table className="w-full text-body-ui">
          <thead>
            <tr className="border-b border-edge bg-sidebar text-left text-caption text-fg-tertiary">
              <th className="px-3 py-2 font-medium">{t("colName")}</th>
              <th className="px-3 py-2 font-medium">{t("colEmail")}</th>
              <th className="px-3 py-2 font-medium">{t("colOrgRole")}</th>
              <th className="px-3 py-2 font-medium">{t("colProvider")}</th>
              <th className="px-3 py-2 font-medium">{t("colLastLogin")}</th>
              <th className="px-3 py-2 font-medium">{t("colStatus")}</th>
              <th className="px-3 py-2 font-medium">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className="border-b border-edge last:border-b-0">
                <td className="px-3 py-2 font-medium text-fg">{u.name}</td>
                <td className="px-3 py-2 text-fg-secondary">{u.email}</td>
                <td className="px-3 py-2">
                  <OrgRoleSelect userId={u.id} orgRole={u.orgRole} />
                </td>
                <td className="px-3 py-2">
                  <Badge variant={u.authProvider === "local" ? "neutral" : "primary"}>
                    {t(`provider.${u.authProvider}`)}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-fg-secondary">
                  {u.lastLoginAt ? dateFormat.format(u.lastLoginAt) : "—"}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={u.isActive ? "success" : "danger"}>
                    {u.isActive ? t("statusActive") : t("statusInactive")}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <ResetPasswordButton userId={u.id} name={u.name} />
                    <ActiveToggle userId={u.id} isActive={u.isActive} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
