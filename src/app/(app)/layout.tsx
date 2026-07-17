import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Home, Library, Trash2 } from "lucide-react";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { isEmbeddingConfigured, isLlmConfigured } from "@/lib/llm";
import { countUnread, listNotifications } from "@/lib/notifications";
import { listCollections } from "@/lib/spaces/collections";
import { groupSpacesByCollection } from "@/lib/spaces/grouping";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import { getUiVersion, isUiVersionSwitcherEnabled } from "@/lib/ui-version-server";
import { AppShell } from "@/components/layout/app-shell";
import { ArchiveAppShell } from "@/components/layout/archive-app-shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await requireSession();
  const t = await getTranslations("shell");
  const [spaces, collections, notifications, unreadNotifications, uiVersion] = await Promise.all([
    listAccessibleSpaces(user),
    listCollections(),
    listNotifications(user.id),
    countUnread(user.id),
    getUiVersion(),
  ]);

  // 側欄「我的空間」依 collection 分組，未分組排最後（C-09）。
  const groups = groupSpacesByCollection(
    spaces,
    collections.map((c) => ({ id: c.id, name: c.name })),
  );
  const hasNamedCollection = groups.some((g) => g.collection !== null);

  const sidebar = (
    <nav className="flex flex-col gap-0.5 text-body-ui">
      <SidebarLink href="/" icon={<Home className="size-4" />} label={t("home")} />
      <SidebarLink href="/spaces" icon={<Library className="size-4" />} label={t("allSpaces")} />
      <SidebarLink href="/trash" icon={<Trash2 className="size-4" />} label={t("trash")} />
      {spaces.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          <p className="px-2 text-caption font-medium text-fg-tertiary">{t("mySpaces")}</p>
          {groups.map((group) => (
            <div key={group.collection?.id ?? "__ungrouped__"} className="flex flex-col gap-0.5">
              {/* 有具名分組時才顯示子標頭（含未分組）；全部未分組則維持平面列表。 */}
              {hasNamedCollection ? (
                <p className="px-2 pt-1 text-caption text-fg-tertiary">
                  {group.collection ? group.collection.name : t("ungrouped")}
                </p>
              ) : null}
              {group.spaces.map((s) => (
                <SidebarLink
                  key={s.id}
                  href={`/s/${s.slug}`}
                  icon={<span className="text-sm">{s.icon ?? "📘"}</span>}
                  label={s.name}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </nav>
  );

  // 主題 class 由 root layout 依 DB 偏好在 SSR 直接掛載（G-03），此處不再於 client 校正，
  // 以尊重「localStorage 覆蓋 > SSR class > 系統」精度，避免整頁重載時覆寫本機偏好。
  const Shell = uiVersion === "archive" ? ArchiveAppShell : AppShell;

  return (
    <Shell
      user={{ name: user.name, email: user.email, isAdmin: isOrgAdmin(user) }}
      sidebar={sidebar}
      llmConfigured={isLlmConfigured()}
      embeddingConfigured={isEmbeddingConfigured()}
      notifications={notifications}
      unreadNotifications={unreadNotifications}
      uiVersion={uiVersion}
      uiVersionSwitchEnabled={isUiVersionSwitcherEnabled()}
    >
      {children}
    </Shell>
  );
}

function SidebarLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
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
