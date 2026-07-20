"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { PanelLeftClose } from "lucide-react";
import { AiChatDrawer } from "@/components/ai/ai-chat-drawer";
import { ArchiveMark } from "@/components/brand/archive-mark";
import { getArchiveSidebarPresentation } from "@/lib/archive-navigation";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { IconButton } from "@/components/ui/icon-button";
import type { BuildInfo } from "@/lib/build-info";
import type { NotificationView } from "@/lib/notifications";
import { ArchiveCommandRail } from "./archive-command-rail";
import { ArchiveTopbar } from "./archive-topbar";
import { CommandPalette } from "./command-palette";
import { OfflineBanner } from "./offline-banner";

const SIDEBAR_KEY = "jetbook-sidebar-collapsed";

interface ArchiveAppShellProps {
  user: { name: string; email: string; isAdmin?: boolean };
  sidebar: ReactNode;
  children: ReactNode;
  /** AI 生成已設定（isLlmConfigured）：Cmd+K「問 AI」列與 ✦／⌘J AI 抽屜入口據此啟用（NFR-AVAIL-02）。 */
  llmConfigured?: boolean;
  /** 語意索引已設定（isEmbeddingConfigured）：Cmd+K 語意區據此渲染。 */
  embeddingConfigured?: boolean;
  /** 站內通知（K-02）：由 RSC layout 查詢後注入鈴鐺初始資料。 */
  notifications?: NotificationView[];
  /** 未讀通知數（鈴鐺徽章初值）。 */
  unreadNotifications?: number;
  /** 當前部署的 build 資訊（#267）：常駐 badge 與 UserMenu 底部顯示。 */
  buildInfo: BuildInfo;
}

export function ArchiveAppShell({
  user,
  sidebar,
  children,
  llmConfigured = false,
  embeddingConfigured = false,
  notifications = [],
  unreadNotifications = 0,
  buildInfo,
}: ArchiveAppShellProps) {
  const t = useTranslations("shell");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [spaceGlobalDockOpen, setSpaceGlobalDockOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const mobileDockTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDockCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setSpaceGlobalDockOpen(false);
  }, [pathname]);

  const sidebarPresentation = getArchiveSidebarPresentation(
    pathname,
    dockCollapsed,
    spaceGlobalDockOpen,
  );
  const showGlobalDock = sidebarPresentation === "expanded";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        if (window.matchMedia("(max-width: 1023px)").matches) {
          setMobileOpen((current) => !current);
          return;
        }
        if (pathname.startsWith("/s/")) {
          setDockCollapsed(false);
          setSpaceGlobalDockOpen((current) => !current);
          localStorage.setItem(SIDEBAR_KEY, "0");
          return;
        }
        setDockCollapsed((current) => {
          const next = !current;
          localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
          return next;
        });
      }

      if (
        llmConfigured &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        (event.key === "j" || event.key === "J")
      ) {
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        setAiOpen((current) => !current);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [llmConfigured, pathname]);

  function expandDock() {
    setDockCollapsed(false);
    setSpaceGlobalDockOpen(true);
    localStorage.setItem(SIDEBAR_KEY, "0");
  }

  function collapseDock() {
    setDockCollapsed(true);
    setSpaceGlobalDockOpen(false);
    localStorage.setItem(SIDEBAR_KEY, "1");
  }

  return (
    <div className="archive-shell flex h-dvh flex-col bg-base">
      <OfflineBanner />
      <div className="flex min-h-0 flex-1">
        {showGlobalDock ? (
          <aside
            aria-label={t("archiveRail")}
            className="archive-unified-sidebar hidden w-[288px] shrink-0 flex-col border-r border-edge bg-sidebar lg:flex"
          >
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-edge px-3">
              <Link
                href="/"
                aria-label={tc("appName")}
                className="flex min-w-0 flex-1 items-center gap-2 text-fg"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xs bg-[var(--archive-index)] text-[var(--archive-index-ink)]">
                  <ArchiveMark className="size-6 [&_path]:stroke-current [&_path:first-child]:fill-transparent" />
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-body-ui font-semibold">
                    {tc("appName")}
                  </strong>
                  <small className="block truncate font-mono text-[9px] tracking-[0.14em] text-fg-tertiary">
                    {t("archiveKicker")}
                  </small>
                </span>
              </Link>
              <IconButton label={t("collapseSidebar")} onClick={collapseDock}>
                <PanelLeftClose className="size-4" />
              </IconButton>
            </div>
            <ArchiveCommandRail
              presentation="expanded"
              llmConfigured={llmConfigured}
              aiOpen={aiOpen}
              onSearch={() => setPaletteOpen(true)}
              onAi={() => setAiOpen((current) => !current)}
            />
            <div className="flex h-10 shrink-0 items-center border-y border-edge px-3">
              <p className="font-mono text-[10px] font-medium tracking-[0.14em] text-fg-tertiary">
                {t("archiveDock")}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">{sidebar}</div>
          </aside>
        ) : (
          <ArchiveCommandRail
            presentation="compact"
            llmConfigured={llmConfigured}
            aiOpen={aiOpen}
            onSearch={() => setPaletteOpen(true)}
            onAi={() => setAiOpen((current) => !current)}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <ArchiveTopbar
            user={user}
            notifications={notifications}
            unreadNotifications={unreadNotifications}
            llmConfigured={llmConfigured}
            aiOpen={aiOpen}
            dockCollapsed={!showGlobalDock}
            buildInfo={buildInfo}
            mobileDockTriggerRef={mobileDockTriggerRef}
            onOpenMobileDock={() => setMobileOpen(true)}
            onExpandDock={expandDock}
            onOpenSearch={() => setPaletteOpen(true)}
            onToggleAi={() => setAiOpen((current) => !current)}
          />

          <div className="flex min-h-0 flex-1">
            <main className="archive-canvas min-w-0 flex-1 overflow-y-auto bg-base">
              {children}
            </main>
          </div>
        </div>
      </div>

      <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
        <DrawerContent
          title={t("archiveDock")}
          closeLabel={tc("close")}
          className="left-0 right-auto w-72 border-l-0 border-r border-edge lg:hidden"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            mobileDockTriggerRef.current?.focus();
          }}
        >
          <div className="px-2 py-3">{sidebar}</div>
        </DrawerContent>
      </Drawer>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        llmConfigured={llmConfigured}
        embeddingConfigured={embeddingConfigured}
      />

      {llmConfigured ? <AiChatDrawer open={aiOpen} onOpenChange={setAiOpen} /> : null}
    </div>
  );
}
