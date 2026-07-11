import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Activity, Archive, Sparkles, Users } from "lucide-react";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";

/**
 * 管理後台獨立版面（§3.11）：左側固定管理選單（220px）＋內容區。
 * 僅 org admin 可進入；非 admin 一律 404（不洩漏後台存在性）。
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user } = await requireSession("/admin");
  if (!isOrgAdmin(user)) notFound();
  const t = await getTranslations("admin");

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-edge bg-base px-4">
        <Link href="/" className="text-h4 font-bold text-fg">
          JetBook
        </Link>
        <span className="text-body-ui text-fg-secondary">{t("title")}</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-edge bg-sidebar p-2">
          <nav className="flex flex-col gap-0.5 text-body-ui">
            <AdminNavLink href="/admin/users" icon={<Users aria-hidden className="size-4" />}>
              {t("navUsers")}
            </AdminNavLink>
            <AdminNavLink href="/admin/spaces" icon={<Archive aria-hidden className="size-4" />}>
              {t("navSpaces")}
            </AdminNavLink>
            <AdminNavLink href="/admin/ai" icon={<Sparkles aria-hidden className="size-4" />}>
              {t("navAi")}
            </AdminNavLink>
            <AdminNavLink href="/admin/system" icon={<Activity aria-hidden className="size-4" />}>
              {t("navSystem")}
            </AdminNavLink>
          </nav>
          <div className="mt-auto pt-4">
            <Link
              href="/"
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-fg-tertiary transition-colors hover:bg-hover hover:text-fg"
            >
              <ArrowLeft aria-hidden className="size-4" />
              {t("backToApp")}
            </Link>
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto bg-base">{children}</main>
      </div>
    </div>
  );
}

function AdminNavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
    >
      {icon}
      <span className="truncate">{children}</span>
    </Link>
  );
}
