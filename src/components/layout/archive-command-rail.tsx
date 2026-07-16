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
}: {
  llmConfigured: boolean;
  aiOpen: boolean;
  onSearch: () => void;
  onAi: () => void;
}) {
  const pathname = usePathname();
  const t = useTranslations("shell");

  return (
    <aside
      aria-label={t("archiveRail")}
      className="hidden w-[72px] shrink-0 flex-col items-center border-r border-[var(--archive-rail-border)] bg-[var(--archive-rail)] py-3 text-[var(--archive-rail-text)] lg:flex"
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
