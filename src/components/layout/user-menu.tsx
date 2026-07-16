"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut, RefreshCcw, Settings, ShieldCheck } from "lucide-react";
import { logout } from "@/actions/auth";
import { setUiVersionAction } from "@/actions/ui-version";
import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { UiVersion } from "@/lib/ui-version";

export function UserMenu({
  name,
  email,
  isAdmin = false,
  uiVersion = "legacy",
  uiVersionSwitchEnabled = false,
}: {
  name: string;
  email: string;
  /** org admin 顯示「管理後台」入口（§3.11） */
  isAdmin?: boolean;
  uiVersion?: UiVersion;
  uiVersionSwitchEnabled?: boolean;
}) {
  const t = useTranslations("shell");
  const router = useRouter();
  const [switching, startTransition] = useTransition();
  const nextUiVersion: UiVersion = uiVersion === "archive" ? "legacy" : "archive";

  function switchUiVersion() {
    startTransition(async () => {
      await setUiVersionAction(nextUiVersion);
      router.refresh();
    });
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("userMenu")}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--primary)]"
      >
        <Avatar name={name} colorKey={email} size="md" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <div className="border-b border-edge px-3 py-2">
          <p className="truncate text-body-ui font-medium text-fg">{name}</p>
          <p className="truncate text-caption text-fg-tertiary">{email}</p>
        </div>
        <Link
          href="/settings"
          className="flex w-full items-center gap-2 border-b border-edge px-3 py-2 text-body-ui text-fg transition-colors hover:bg-hover"
        >
          <Settings aria-hidden className="size-4" />
          {t("personalSettings")}
        </Link>
        {isAdmin ? (
          <Link
            href="/admin"
            className="flex w-full items-center gap-2 border-b border-edge px-3 py-2 text-body-ui text-fg transition-colors hover:bg-hover"
          >
            <ShieldCheck aria-hidden className="size-4" />
            {t("adminConsole")}
          </Link>
        ) : null}
        {uiVersionSwitchEnabled ? (
          <button
            type="button"
            disabled={switching}
            onClick={switchUiVersion}
            className="flex w-full items-center gap-2 border-b border-edge px-3 py-2 text-body-ui text-fg transition-colors hover:bg-hover disabled:text-fg-disabled"
          >
            <RefreshCcw aria-hidden className="size-4" />
            {switching
              ? t("uiSwitching")
              : uiVersion === "archive"
                ? t("switchToLegacy")
                : t("switchToArchive")}
          </button>
        ) : null}
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 px-3 py-2 text-body-ui text-fg transition-colors hover:bg-hover"
          >
            <LogOut aria-hidden className="size-4" />
            {t("logout")}
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
