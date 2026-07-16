"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Menu, PanelLeftOpen, Plus, Search, Sparkles } from "lucide-react";
import { ArchiveMark } from "@/components/brand/archive-mark";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import type { NotificationView } from "@/lib/notifications";
import type { UiVersion } from "@/lib/ui-version";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function ArchiveTopbar({
  user,
  notifications,
  unreadNotifications,
  llmConfigured,
  aiOpen,
  dockCollapsed,
  uiVersion,
  uiVersionSwitchEnabled,
  onOpenDock,
  onOpenSearch,
  onToggleAi,
}: {
  user: { name: string; email: string; isAdmin?: boolean };
  notifications: NotificationView[];
  unreadNotifications: number;
  llmConfigured: boolean;
  aiOpen: boolean;
  dockCollapsed: boolean;
  uiVersion: UiVersion;
  uiVersionSwitchEnabled: boolean;
  onOpenDock: () => void;
  onOpenSearch: () => void;
  onToggleAi: () => void;
}) {
  const t = useTranslations("shell");
  const tc = useTranslations("common");

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-edge bg-raised px-2 sm:px-4">
      <IconButton label={t("toggleSidebar")} onClick={onOpenDock} className="lg:hidden">
        <Menu className="size-5" />
      </IconButton>
      {dockCollapsed ? (
        <IconButton
          label={t("toggleSidebar")}
          onClick={onOpenDock}
          className="hidden lg:inline-flex"
        >
          <PanelLeftOpen className="size-4" />
        </IconButton>
      ) : null}

      <Link href="/" className="flex min-w-0 items-center gap-2 text-fg">
        <ArchiveMark className="size-7 lg:hidden" />
        <span className="truncate text-body-ui font-semibold sm:text-h4">{tc("appName")}</span>
        <span className="hidden border-l border-edge pl-2 font-mono text-[10px] tracking-[0.14em] text-fg-tertiary xl:inline">
          {t("archiveKicker")}
        </span>
      </Link>

      <button
        type="button"
        onClick={onOpenSearch}
        className="mx-auto hidden h-8 w-full max-w-lg items-center gap-2 rounded-xs border border-edge bg-base px-3 text-body-ui text-fg-tertiary transition-colors hover:border-edge-strong md:flex"
      >
        <Search aria-hidden className="size-4" />
        <span className="flex-1 truncate text-left">{t("searchPlaceholder")}</span>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
        <IconButton label={t("searchPlaceholder")} onClick={onOpenSearch} className="md:hidden">
          <Search className="size-4" />
        </IconButton>
        <Button asChild size="sm" className="hidden xl:inline-flex">
          <Link href="/spaces">
            <Plus aria-hidden className="size-4" />
            {t("create")}
          </Link>
        </Button>
        {llmConfigured ? (
          <IconButton
            label={t("aiAssistant")}
            aria-pressed={aiOpen}
            onClick={onToggleAi}
            className="bg-ai-tint text-ai hover:bg-ai-tint hover:text-ai"
          >
            <Sparkles className="size-4" />
          </IconButton>
        ) : null}
        <NotificationBell initialItems={notifications} initialUnread={unreadNotifications} />
        <ThemeToggle />
        <UserMenu
          name={user.name}
          email={user.email}
          isAdmin={user.isAdmin}
          uiVersion={uiVersion}
          uiVersionSwitchEnabled={uiVersionSwitchEnabled}
        />
      </div>
    </header>
  );
}
