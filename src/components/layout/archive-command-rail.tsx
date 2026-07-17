"use client";

import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Home, Library, Search, Settings, Sparkles } from "lucide-react";
import { ArchiveMark } from "@/components/brand/archive-mark";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type RailIcon = ComponentType<SVGProps<SVGSVGElement>>;

export function ArchiveCommandRail({
  llmConfigured,
  aiOpen,
  onSearch,
  onAi,
  presentation = "compact",
}: {
  llmConfigured: boolean;
  aiOpen: boolean;
  onSearch: () => void;
  onAi: () => void;
  presentation?: "compact" | "expanded";
}) {
  const pathname = usePathname();
  const t = useTranslations("shell");

  if (presentation === "expanded") {
    return (
      <nav className="archive-command-nav flex flex-col gap-1 px-2 py-2" aria-label={t("archivePrimaryNav")}>
        <ExpandedRailButton
          label={t("searchPlaceholder")}
          icon={Search}
          active={pathname === "/search"}
          onClick={onSearch}
        />
        {llmConfigured ? (
          <ExpandedRailButton
            label={t("aiAssistant")}
            icon={Sparkles}
            active={aiOpen}
            onClick={onAi}
          />
        ) : null}
        <div className="mt-1 border-t border-edge pt-1">
          <ExpandedRailLink
            href="/settings"
            label={t("personalSettings")}
            icon={Settings}
            active={pathname.startsWith("/settings")}
          />
        </div>
      </nav>
    );
  }

  return (
    <aside
      aria-label={t("archiveRail")}
      className="archive-command-rail hidden w-[72px] shrink-0 flex-col items-center border-r border-[var(--archive-rail-border)] bg-[var(--archive-rail)] py-3 text-[var(--archive-rail-text)] lg:flex"
    >
      <Tooltip content={t("home")} side="right">
        <Link
          href="/"
          aria-label={t("home")}
          className="mb-6 grid size-10 place-items-center rounded-xs bg-[var(--archive-index)] text-[var(--archive-index-ink)] transition-transform hover:-translate-y-0.5"
        >
          <ArchiveMark className="size-7 [&_path]:stroke-current [&_path:first-child]:fill-transparent" />
        </Link>
      </Tooltip>

      <nav className="flex flex-col items-center gap-1" aria-label={t("archivePrimaryNav")}>
        <RailLink href="/" label={t("home")} icon={Home} active={pathname === "/"} />
        <RailLink
          href="/spaces"
          label={t("allSpaces")}
          icon={Library}
          active={pathname === "/spaces" || pathname.startsWith("/s/")}
        />
        <RailButton
          label={t("searchPlaceholder")}
          icon={Search}
          active={pathname === "/search"}
          onClick={onSearch}
        />
        {llmConfigured ? (
          <RailButton label={t("aiAssistant")} icon={Sparkles} active={aiOpen} onClick={onAi} />
        ) : null}
      </nav>

      <div className="mt-auto">
        <RailLink
          href="/settings"
          label={t("personalSettings")}
          icon={Settings}
          active={pathname.startsWith("/settings")}
        />
      </div>
    </aside>
  );
}

function ExpandedRailLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: RailIcon;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={expandedRailItemClass(active)}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
  );
}

function ExpandedRailButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: RailIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={expandedRailItemClass(active)}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    </button>
  );
}

function RailLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: RailIcon;
  active: boolean;
}) {
  return (
    <Tooltip content={label} side="right">
      <Link
        href={href}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={railItemClass(active)}
      >
        <Icon aria-hidden className="size-[18px]" />
        {active ? (
          <span aria-hidden className="absolute -left-[15px] h-6 w-[3px] bg-primary" />
        ) : null}
      </Link>
    </Tooltip>
  );
}

function RailButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: RailIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={railItemClass(active)}
      >
        <Icon aria-hidden className="size-[18px]" />
        {active ? (
          <span aria-hidden className="absolute -left-[15px] h-6 w-[3px] bg-primary" />
        ) : null}
      </button>
    </Tooltip>
  );
}

function railItemClass(active: boolean): string {
  return cn(
    "relative grid size-10 place-items-center rounded-xs transition-colors",
    active
      ? "bg-[var(--archive-rail-active)] text-[var(--archive-rail-text-active)]"
      : "hover:bg-[var(--archive-rail-active)] hover:text-[var(--archive-rail-text-active)]",
  );
}

function expandedRailItemClass(active: boolean): string {
  return cn(
    "relative flex h-9 w-full items-center gap-2 rounded-xs px-2.5 text-body-ui transition-colors",
    active
      ? "bg-hover text-fg before:absolute before:left-0 before:h-5 before:w-0.5 before:rounded-full before:bg-primary"
      : "text-fg-secondary hover:bg-hover hover:text-fg",
  );
}
