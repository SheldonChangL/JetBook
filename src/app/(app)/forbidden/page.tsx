import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { requireSession, isSafeReturnTo } from "@/lib/auth/current";
import { getSpaceRole } from "@/lib/authz/permission";
import { listSpaceAdmins } from "@/lib/spaces/queries";
import { getUiVersion } from "@/lib/ui-version-server";
import { ArchiveSystemState } from "@/components/layout/archive-system-state";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * 403 頁（G-04，設計規範 §3.12）：沿用 App Shell，使用者不會「掉出」系統。
 * M1 先顯示 Space 管理員資訊；「向管理員申請權限」按鈕（F-SEC-10）於 K-02 通知上線後啟用。
 * `from` 僅接受站內相對路徑；Space 資訊只在使用者本就可見該 Space（org 可見）時顯示，
 * 避免直接開 /forbidden?from= 探測 private Space 存在性。
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { user } = await requireSession("/");
  const { from } = await searchParams;
  const t = await getTranslations("errors.forbidden");
  const uiVersion = await getUiVersion();

  const spaceSlug = from && isSafeReturnTo(from) ? /^\/s\/([^/?#]+)/.exec(from)?.[1] : undefined;

  let spaceInfo: { name: string; admins: { name: string; email: string }[] } | null = null;
  if (spaceSlug) {
    const space = await db.query.spaces.findFirst({
      where: and(eq(spaces.slug, spaceSlug), isNull(spaces.deletedAt)),
    });
    // 只有使用者對該 Space 具任一角色（org 可見或本人為成員）才顯示，不洩漏 private Space。
    if (space && (await getSpaceRole(user, space.id))) {
      spaceInfo = { name: space.name, admins: await listSpaceAdmins(space.id) };
    }
  }

  const adminDetails =
    spaceInfo && spaceInfo.admins.length > 0 ? (
      <div className="w-full max-w-sm border-l-2 border-primary bg-sidebar px-4 py-3">
        <p className="mb-1 text-caption font-medium text-fg-secondary">
          {t("spaceAdmins", { space: spaceInfo.name })}
        </p>
        <ul className="flex flex-col gap-0.5">
          {spaceInfo.admins.map((admin) => (
            <li key={admin.email} className="text-caption text-fg-tertiary">
              {admin.name}
              {" ("}
              {admin.email}
              {")"}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  if (uiVersion === "archive") {
    return (
      <ArchiveSystemState
        code={t("code")}
        icon={<ShieldAlert />}
        title={t("title")}
        description={t("description")}
        details={adminDetails}
        action={
          <Button asChild variant="primary">
            <Link href="/">{t("backHome")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center py-12">
      <div className="flex flex-col items-center">
        <EmptyState
          icon={<ShieldAlert />}
          title={t("title")}
          description={t("description")}
          action={
            <Button asChild variant="primary">
              <Link href="/">{t("backHome")}</Link>
            </Button>
          }
        />
        {spaceInfo && spaceInfo.admins.length > 0 ? (
          <div className="mt-2 w-full max-w-sm rounded-md border border-edge bg-sidebar px-4 py-3">
            <p className="mb-1 text-caption font-medium text-fg-secondary">
              {t("spaceAdmins", { space: spaceInfo.name })}
            </p>
            <ul className="flex flex-col gap-0.5">
              {spaceInfo.admins.map((a) => (
                <li key={a.email} className="text-caption text-fg-tertiary">
                  {a.name}
                  {" ("}
                  {a.email}
                  {")"}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
