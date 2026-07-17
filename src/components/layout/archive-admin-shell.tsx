"use client";

import { useRef, type ComponentType, type ReactNode, type SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  Archive,
  ArrowLeft,
  Menu,
  ScrollText,
  Sparkles,
  Users,
  UsersRound,
} from "lucide-react";
import { ArchiveMark } from "@/components/brand/archive-mark";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import type { UiVersion } from "@/lib/ui-version";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

type AdminIcon = ComponentType<SVGProps<SVGSVGElement>>;

export function ArchiveAdminShell({
  user,
  uiVersion,
  uiVersionSwitchEnabled,
  children,
}: {
  user: { name: string; email: string };
  uiVersion: UiVersion;
  uiVersionSwitchEnabled: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null);

  const navItems = [
    { href: "/admin/users", label: t("navUsers"), icon: Users },
    { href: "/admin/groups", label: t("navGroups"), icon: UsersRound },
    { href: "/admin/spaces", label: t("navSpaces"), icon: Archive },
    { href: "/admin/ai", label: t("navAi"), icon: Sparkles },
    { href: "/admin/audit", label: t("navAudit"), icon: ScrollText },
    { href: "/admin/system", label: t("navSystem"), icon: Activity },
  ];

  return (
    <div className="archive-admin-shell flex h-dvh bg-base">
      <aside
        aria-label={t("title")}
        className="hidden w-[72px] shrink-0 flex-col items-center border-r border-[var(--archive-rail-border)] bg-[var(--archive-rail)] py-3 text-[var(--archive-rail-text)] lg:flex"
      >
        <Tooltip content={tc("appName")} side="right">
          <Link
            href="/"
            aria-label={tc("appName")}
            className="mb-5 grid size-10 place-items-center rounded-xs bg-[var(--archive-index)] text-[var(--archive-index-ink)]"
          >
            <ArchiveMark className="size-7 [&_path]:stroke-current [&_path:first-child]:fill-transparent" />
          </Link>
        </Tooltip>

        <nav className="flex flex-col gap-1" aria-label={t("title")}>
          {navItems.map((item) => (
            <AdminRailLink key={item.href} {...item} active={pathname.startsWith(item.href)} />
          ))}
        </nav>

        <div className="mt-auto">
          <AdminRailLink href="/" label={t("backToApp")} icon={ArrowLeft} active={false} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-edge bg-raised px-2 sm:px-4">
          <IconButton
            ref={mobileNavTriggerRef}
            label={t("title")}
            onClick={() => setMobileOpen(true)}
            className="lg:hidden"
          >
            <Menu className="size-5" />
          </IconButton>
          <Link href="/" className="flex items-center gap-2 text-fg lg:hidden">
            <ArchiveMark className="size-7" />
            <span className="text-body-ui font-semibold">{tc("appName")}</span>
          </Link>
          <div className="hidden items-baseline gap-3 lg:flex">
            <span className="text-h4 font-semibold text-fg">{t("title")}</span>
            <span className="font-mono text-[10px] tracking-[0.14em] text-fg-tertiary">
              {t("archiveKicker")}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu
              name={user.name}
              email={user.email}
              isAdmin
              uiVersion={uiVersion}
              uiVersionSwitchEnabled={uiVersionSwitchEnabled}
            />
          </div>
        </header>

        <main className="archive-canvas min-h-0 flex-1 overflow-y-auto bg-base">{children}</main>
      </div>

      <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
        <DrawerContent
          title={t("title")}
          closeLabel={tc("close")}
          className="left-0 right-auto w-72 border-l-0 border-r border-edge lg:hidden"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            mobileNavTriggerRef.current?.focus();
          }}
        >
          <nav className="flex flex-col gap-1 p-2" aria-label={t("title")}>
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-2 rounded-xs px-3 py-2 text-body-ui text-fg-secondary hover:bg-hover hover:text-fg",
                  pathname.startsWith(item.href) && "bg-hover text-fg",
                )}
              >
                <item.icon aria-hidden className="size-4" />
                {item.label}
              </Link>
            ))}
            <Link
              href="/"
              onClick={() => setMobileOpen(false)}
              className="mt-3 flex items-center gap-2 border-t border-edge px-3 py-3 text-body-ui text-fg-secondary"
            >
              <ArrowLeft aria-hidden className="size-4" />
              {t("backToApp")}
            </Link>
          </nav>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function AdminRailLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: AdminIcon;
  active: boolean;
}) {
  return (
    <Tooltip content={label} side="right">
      <Link
        href={href}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative grid size-10 place-items-center rounded-xs transition-colors",
          active
            ? "bg-[var(--archive-rail-active)] text-[var(--archive-rail-text-active)]"
            : "hover:bg-[var(--archive-rail-active)] hover:text-[var(--archive-rail-text-active)]",
        )}
      >
        <Icon aria-hidden className="size-[18px]" />
        {active ? (
          <span aria-hidden className="absolute -left-[15px] h-6 w-[3px] bg-primary" />
        ) : null}
      </Link>
    </Tooltip>
  );
}
