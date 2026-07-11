import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Home, Library, Trash2 } from "lucide-react";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import type { Theme } from "@/lib/theme";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeSync } from "@/components/layout/theme-sync";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await requireSession();
  const t = await getTranslations("shell");
  const spaces = await listAccessibleSpaces(user);

  const sidebar = (
    <nav className="flex flex-col gap-0.5 text-body-ui">
      <SidebarLink href="/" icon={<Home className="size-4" />} label={t("home")} />
      <SidebarLink href="/spaces" icon={<Library className="size-4" />} label={t("allSpaces")} />
      <SidebarLink href="/trash" icon={<Trash2 className="size-4" />} label={t("trash")} />
      {spaces.length > 0 ? (
        <div className="mt-4">
          <p className="px-2 pb-1 text-caption font-medium text-fg-tertiary">{t("mySpaces")}</p>
          {spaces.map((s) => (
            <SidebarLink
              key={s.id}
              href={`/s/${s.slug}`}
              icon={<span className="text-sm">{s.icon ?? "📘"}</span>}
              label={s.name}
            />
          ))}
        </div>
      ) : null}
    </nav>
  );

  const serverTheme: Theme =
    user.themePreference === "light" || user.themePreference === "dark"
      ? user.themePreference
      : "system";

  return (
    <>
      <ThemeSync serverTheme={serverTheme} />
      <AppShell
        user={{ name: user.name, email: user.email, isAdmin: isOrgAdmin(user) }}
        sidebar={sidebar}
      >
        {children}
      </AppShell>
    </>
  );
}

function SidebarLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}
