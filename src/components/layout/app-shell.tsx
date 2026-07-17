"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Menu, PanelLeftClose, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { AiChatDrawer } from "@/components/ai/ai-chat-drawer";
import type { BuildInfo } from "@/lib/build-info";
import type { NotificationView } from "@/lib/notifications";
import type { UiVersion } from "@/lib/ui-version";
import { BuildBadge } from "./build-badge";
import { CommandPalette } from "./command-palette";
import { NotificationBell } from "./notification-bell";
import { OfflineBanner } from "./offline-banner";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

const SIDEBAR_KEY = "jetbook-sidebar-collapsed";

export interface AppShellProps {
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
  uiVersion?: UiVersion;
  uiVersionSwitchEnabled?: boolean;
  /** 當前部署的 build 資訊（#267）：常駐 badge 與 UserMenu 底部顯示。 */
  buildInfo: BuildInfo;
}

/**
 * App Shell 三欄版面骨架（G-01，設計規範 §1–§2）：
 * 56px 頂部列 + 可收合左側欄（⌘\、記憶狀態）+ 內容區。右側 TOC/AI 抽屜由頁面掛載。
 * 響應式：md 以下側欄轉 overlay 抽屜。AI 問答抽屜由 ✦ 鈕或 ⌘J 開關（I-03）。
 */
export function AppShell({
  user,
  sidebar,
  children,
  llmConfigured = false,
  embeddingConfigured = false,
  notifications = [],
  unreadNotifications = 0,
  uiVersion = "legacy",
  uiVersionSwitchEnabled = false,
  buildInfo,
}: AppShellProps) {
  const t = useTranslations("shell");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setCollapsed((v) => {
          const next = !v;
          localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
          return next;
        });
      }
      // ⌘J／Ctrl+J 開關 AI 抽屜；IME 組字中不誤觸（isComposing 防護）。
      if (llmConfigured && (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "j" || e.key === "J")) {
        if (e.isComposing) return;
        e.preventDefault();
        setAiOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [llmConfigured]);

  return (
    <div className="flex h-dvh flex-col">
      {/* 全域離線提示（§3.12） */}
      <OfflineBanner />
      {/* 頂部列 */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-edge bg-base px-3">
        <button
          type="button"
          aria-label={t("toggleSidebar")}
          onClick={() => {
            setMobileOpen((v) => !v);
            setCollapsed((v) => {
              const next = !v;
              localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
              return next;
            });
          }}
          className="rounded-sm p-1.5 text-fg-secondary hover:bg-hover md:hidden"
        >
          <Menu className="size-5" />
        </button>
        <Link href="/" className="text-h4 font-bold text-fg">
          JetBook
        </Link>

        <div className="mx-auto w-full max-w-md">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-8 w-full items-center gap-2 rounded-md border border-edge bg-sidebar px-3 text-body-ui text-fg-tertiary transition-colors hover:border-edge-strong"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">{t("searchPlaceholder")}</span>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </button>
        </div>

        <div className="flex items-center gap-1">
          {llmConfigured ? (
            <IconButton
              label={t("aiAssistant")}
              aria-pressed={aiOpen}
              onClick={() => setAiOpen((v) => !v)}
              className={cn(
                "bg-ai-tint text-ai hover:bg-ai-tint hover:text-ai",
                aiOpen && "ring-2 ring-ai",
              )}
            >
              <Sparkles className="size-4" />
            </IconButton>
          ) : null}
          <NotificationBell initialItems={notifications} initialUnread={unreadNotifications} />
          <ThemeToggle />
          <BuildBadge info={buildInfo} className="mx-1 hidden sm:inline-block" />
          <UserMenu
            name={user.name}
            email={user.email}
            isAdmin={user.isAdmin}
            uiVersion={uiVersion}
            uiVersionSwitchEnabled={uiVersionSwitchEnabled}
            buildInfo={buildInfo}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左側欄（桌面） */}
        <aside
          className={cn(
            "hidden shrink-0 flex-col border-r border-edge bg-sidebar md:flex",
            collapsed ? "w-0 overflow-hidden border-r-0" : "w-70",
          )}
          style={collapsed ? undefined : { width: "280px" }}
        >
          <div className="flex items-center justify-end p-2">
            <IconButton
              label={t("collapseSidebar")}
              onClick={() => {
                setCollapsed(true);
                localStorage.setItem(SIDEBAR_KEY, "1");
              }}
            >
              <PanelLeftClose className="size-4" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">{sidebar}</div>
        </aside>

        {/* 左側欄（行動 overlay） */}
        {mobileOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
            <aside className="absolute inset-y-0 left-0 w-72 max-w-[80vw] overflow-y-auto border-r border-edge bg-sidebar p-2">
              {sidebar}
            </aside>
          </div>
        ) : null}

        {/* 內容區 */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-base">{children}</main>
      </div>

      {/* 全域搜尋命令面板（F-SEARCH-02，⌘K 呼出；I-05 語意區＋問 AI） */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        llmConfigured={llmConfigured}
        embeddingConfigured={embeddingConfigured}
      />

      {/* AI 問答抽屜（I-03，✦／⌘J 開關）；未啟用時不掛載 */}
      {llmConfigured ? <AiChatDrawer open={aiOpen} onOpenChange={setAiOpen} /> : null}
    </div>
  );
}
