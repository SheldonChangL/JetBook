"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PanelLeftClose } from "lucide-react";
import { AiChatDrawer } from "@/components/ai/ai-chat-drawer";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { IconButton } from "@/components/ui/icon-button";
import type { AppShellProps } from "./app-shell";
import { ArchiveCommandRail } from "./archive-command-rail";
import { ArchiveTopbar } from "./archive-topbar";
import { CommandPalette } from "./command-palette";
import { OfflineBanner } from "./offline-banner";

const SIDEBAR_KEY = "jetbook-sidebar-collapsed";

export function ArchiveAppShell({
  user,
  sidebar,
  children,
  llmConfigured = false,
  embeddingConfigured = false,
  notifications = [],
  unreadNotifications = 0,
  uiVersion = "archive",
  uiVersionSwitchEnabled = false,
}: AppShellProps) {
  const t = useTranslations("shell");
  const tc = useTranslations("common");
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    setDockCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        if (window.matchMedia("(max-width: 1023px)").matches) {
          setMobileOpen((current) => !current);
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
  }, [llmConfigured]);

  function expandDock() {
    setDockCollapsed(false);
    localStorage.setItem(SIDEBAR_KEY, "0");
  }

  function collapseDock() {
    setDockCollapsed(true);
    localStorage.setItem(SIDEBAR_KEY, "1");
  }

  return (
    <div className="archive-shell flex h-dvh flex-col bg-base">
      <OfflineBanner />
      <div className="flex min-h-0 flex-1">
        <ArchiveCommandRail
          llmConfigured={llmConfigured}
          aiOpen={aiOpen}
          onSearch={() => setPaletteOpen(true)}
          onAi={() => setAiOpen((current) => !current)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <ArchiveTopbar
            user={user}
            notifications={notifications}
            unreadNotifications={unreadNotifications}
            llmConfigured={llmConfigured}
            aiOpen={aiOpen}
            dockCollapsed={dockCollapsed}
            uiVersion={uiVersion}
            uiVersionSwitchEnabled={uiVersionSwitchEnabled}
            onOpenMobileDock={() => setMobileOpen(true)}
            onExpandDock={expandDock}
            onOpenSearch={() => setPaletteOpen(true)}
            onToggleAi={() => setAiOpen((current) => !current)}
          />

          <div className="flex min-h-0 flex-1">
            {!dockCollapsed ? (
              <aside className="hidden w-[252px] shrink-0 flex-col border-r border-edge bg-sidebar lg:flex">
                <div className="flex h-12 shrink-0 items-center justify-between border-b border-edge px-3">
                  <p className="font-mono text-[10px] font-medium tracking-[0.14em] text-fg-tertiary">
                    {t("archiveDock")}
                  </p>
                  <IconButton label={t("collapseSidebar")} onClick={collapseDock}>
                    <PanelLeftClose className="size-4" />
                  </IconButton>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">{sidebar}</div>
              </aside>
            ) : null}

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
