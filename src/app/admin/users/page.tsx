import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { listUsers } from "@/lib/admin/users";
import { Badge } from "@/components/ui/badge";
import { CreateUserButton } from "./create-user-button";
import { ImportUsersButton } from "./import-users-button";
import { UsersFilter } from "./users-filter";
import { ActiveToggle, OrgRoleSelect, ResetPasswordButton } from "./user-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("usersTitle") };
}

const PAGE_SIZE = 50;

/** 分頁連結（保留搜尋/狀態條件）。 */
function pageHref(query: string, status: string | undefined, page: number): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/users?${qs}` : "/admin/users";
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  // layout 已擋，但 page 再驗一次（防 soft navigation 繞過；session 查詢有 React cache）
  const { user } = await requireSession("/admin/users");
  if (!isOrgAdmin(user)) notFound();
  const t = await getTranslations("admin");

  const { q = "", status = "all", page = "1" } = await searchParams;
  const query = q.trim();
  const statusFilter = status === "active" || status === "inactive" ? status : undefined;
  const requestedPage = Math.max(1, Number.parseInt(page, 10) || 1);

  const { rows: list, total } = await listUsers({
    query,
    status: statusFilter,
    page: requestedPage,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dateFormat = new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="archive-admin-page archive-admin-users mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="archive-admin-page-header flex items-center justify-between">
        <div>
          <p className="archive-admin-kicker ui-archive-only">{t("archiveUsersKicker")}</p>
          <h1 className="text-h1 text-fg">{t("usersTitle")}</h1>
          <p className="archive-admin-subtitle ui-archive-only">{t("archiveUsersDesc")}</p>
        </div>
        <div className="archive-admin-header-actions flex items-center gap-2">
          <ImportUsersButton />
          <CreateUserButton />
        </div>
      </header>

      <UsersFilter
        initialQuery={query}
        status={statusFilter ?? "all"}
        labels={{
          searchPlaceholder: t("searchPlaceholder"),
          statusLabel: t("colStatus"),
          statusAll: t("statusFilterAll"),
          statusActive: t("statusActive"),
          statusInactive: t("statusInactive"),
        }}
      />

      <div className="archive-admin-table-wrap overflow-x-auto rounded-md border border-edge">
        <table className="archive-admin-table w-full text-body-ui">
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
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-fg-tertiary">
                  {t("usersEmptyFiltered")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="archive-admin-pagination flex items-center justify-between text-body-ui text-fg-secondary">
        <span>{t("usersPaginationInfo", { total, page: requestedPage, totalPages })}</span>
        {totalPages > 1 && (
          <nav className="flex items-center gap-2">
            {requestedPage > 1 ? (
              <Link
                className="rounded-md border border-edge px-3 py-1.5 hover:bg-sidebar"
                href={pageHref(query, statusFilter, requestedPage - 1)}
              >
                {t("pagePrev")}
              </Link>
            ) : (
              <span className="rounded-md border border-edge px-3 py-1.5 opacity-40">
                {t("pagePrev")}
              </span>
            )}
            {requestedPage < totalPages ? (
              <Link
                className="rounded-md border border-edge px-3 py-1.5 hover:bg-sidebar"
                href={pageHref(query, statusFilter, requestedPage + 1)}
              >
                {t("pageNext")}
              </Link>
            ) : (
              <span className="rounded-md border border-edge px-3 py-1.5 opacity-40">
                {t("pageNext")}
              </span>
            )}
          </nav>
        )}
      </footer>
    </div>
  );
}
