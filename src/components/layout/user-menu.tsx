"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { logout } from "@/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function UserMenu({
  name,
  email,
  isAdmin = false,
}: {
  name: string;
  email: string;
  /** org admin 顯示「管理後台」入口（§3.11） */
  isAdmin?: boolean;
}) {
  const t = useTranslations("shell");
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
