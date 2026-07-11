"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Command } from "cmdk";
import { ArrowRight, Clock, FileText, Search, Sparkles } from "lucide-react";
import type { SearchHit } from "@/lib/search/fulltext";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";

const KBD_UP = "↑";
const KBD_DOWN = "↓";
const KBD_ENTER = "↵";
const KBD_ESC = "Esc";

/** /api/recent 回傳的最近瀏覽項目（欄位對應 lib/pages/recent listRecentVisits）。 */
interface RecentItem {
  pageId: string;
  title: string;
  icon: string | null;
  slug: string;
  spaceSlug: string;
  spaceName: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/**
 * 標題關鍵字高亮：先 HTML escape（防 XSS），再以查詢字詞包 <mark>。
 * 中英皆以子字串比對，多字詞以空白切分後個別高亮。
 */
function highlightTitle(title: string, query: string): string {
  const escaped = escapeHtml(title);
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map(escapeHtml);
  if (terms.length === 0) return escaped;
  const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  try {
    return escaped.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
  } catch {
    return escaped;
  }
}

/**
 * 全域搜尋命令面板（F-SEARCH-02，設計規範 §3.6）。
 * - 任頁 ⌘K/Ctrl+K 呼出（IME composition 期間不觸發，防中文輸入誤觸）。
 * - 250ms debounce 打 /api/search；無輸入時顯示最近瀏覽（/api/recent，page_visits 前 5）。
 * - 全鍵盤：↑↓ 選擇、Enter 開啟、⌘Enter 新分頁、Esc 關閉（cmdk 內建於 IME 期間停用導航）。
 * - 「✦ 問 AI」列為 M2 預留（disabled + 徽章）；「顯示全部」導向 /search?q=（F-SEARCH-03）。
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const t = useTranslations("commandPalette");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  openRef.current = open;
  onOpenChangeRef.current = onOpenChange;

  // 全域 ⌘K/Ctrl+K 切換（只註冊一次；IME 組字中不觸發）。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        onOpenChangeRef.current(!openRef.current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 每次開啟重置為無輸入態。
  useEffect(() => {
    if (open) {
      setQuery("");
      setError(false);
    }
  }, [open]);

  // 取資料：無輸入 → 最近瀏覽；有輸入 → 250ms debounce 全文搜尋。
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const ctrl = new AbortController();

    if (q === "") {
      setHits([]);
      setLoading(true);
      setError(false);
      fetch("/api/recent", { signal: ctrl.signal })
        .then((r) => {
          if (!r.ok) throw new Error("recent failed");
          return r.json();
        })
        .then((j) => {
          setRecent(j.data?.items ?? []);
          setLoading(false);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          setError(true);
          setLoading(false);
        });
      return () => ctrl.abort();
    }

    setLoading(true);
    setError(false);
    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => {
          if (!r.ok) throw new Error("search failed");
          return r.json();
        })
        .then((j) => {
          setHits(j.data?.hits ?? []);
          setLoading(false);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          setError(true);
          setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [open, query]);

  const trimmed = query.trim();
  const showAi = trimmed.length >= 2;

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  // ⌘Enter：於新分頁開啟目前選取的頁面列。
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.nativeEvent.isComposing) {
      const el = document.querySelector('[cmdk-item][data-selected="true"]');
      const href = el?.getAttribute("data-href");
      if (href) {
        e.preventDefault();
        window.open(href, "_blank", "noopener,noreferrer");
        onOpenChange(false);
      }
    }
  }

  const itemClass =
    "flex cursor-default select-none items-center gap-3 rounded-md px-3 py-2 text-body-ui text-fg data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-60 data-[selected=true]:bg-hover";
  const statusClass = "px-3 py-6 text-center text-body-ui text-fg-tertiary";

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={t("label")}
      shouldFilter={false}
      loop
      onKeyDown={onKeyDown}
      overlayClassName="fixed inset-0 z-50 bg-black/40"
      contentClassName="fixed left-1/2 top-[15vh] z-50 flex max-h-[70vh] w-[calc(100vw-32px)] max-w-[640px] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-raised shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-edge px-4">
        <Search aria-hidden className="size-4 shrink-0 text-fg-tertiary" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={t("inputPlaceholder")}
          className="h-12 w-full bg-transparent text-body text-fg outline-none placeholder:text-fg-tertiary"
        />
      </div>

      <Command.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {showAi ? (
          <Command.Item value="__ask_ai__" disabled className={itemClass}>
            <Sparkles aria-hidden className="size-4 shrink-0 text-ai" />
            <span className="min-w-0 flex-1 truncate">{t("askAi", { query: trimmed })}</span>
            <Badge variant="ai">{t("aiBadge")}</Badge>
          </Command.Item>
        ) : null}

        {trimmed !== "" ? (
          <>
            {loading ? (
              <Command.Loading>
                <div className={statusClass}>{t("loading")}</div>
              </Command.Loading>
            ) : null}
            {!loading && error ? <div className={statusClass}>{t("loadError")}</div> : null}
            {!loading && !error && hits.length === 0 ? (
              <div className={statusClass}>{t("noResults", { query: trimmed })}</div>
            ) : null}
            {!loading && !error && hits.length > 0 ? (
              <Command.Group
                heading={t("resultsHeading")}
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-tertiary"
              >
                {hits.slice(0, 8).map((hit) => {
                  const href = `/s/${hit.spaceSlug}/${hit.slug}`;
                  return (
                    <Command.Item
                      key={hit.pageId}
                      value={href}
                      data-href={href}
                      onSelect={() => go(href)}
                      className={itemClass}
                    >
                      <FileText aria-hidden className="size-4 shrink-0 text-fg-tertiary" />
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate font-medium text-fg [&_mark]:bg-primary-tint [&_mark]:text-primary"
                          dangerouslySetInnerHTML={{ __html: highlightTitle(hit.title, trimmed) }}
                        />
                        <span className="block truncate text-caption text-fg-tertiary">
                          {hit.spaceName}
                        </span>
                      </span>
                    </Command.Item>
                  );
                })}
                <Command.Item
                  value="__show_all__"
                  onSelect={() => go(`/search?q=${encodeURIComponent(trimmed)}`)}
                  className="flex cursor-default select-none items-center gap-2 rounded-md px-3 py-2 text-body-ui font-medium text-primary data-[selected=true]:bg-hover"
                >
                  <span className="flex-1">{t("showAll", { count: hits.length })}</span>
                  <ArrowRight aria-hidden className="size-4 shrink-0" />
                </Command.Item>
              </Command.Group>
            ) : null}
          </>
        ) : (
          <>
            {loading ? (
              <Command.Loading>
                <div className={statusClass}>{t("loading")}</div>
              </Command.Loading>
            ) : null}
            {!loading && error ? <div className={statusClass}>{t("loadError")}</div> : null}
            {!loading && !error && recent.length === 0 ? (
              <div className={statusClass}>{t("emptyRecent")}</div>
            ) : null}
            {!loading && !error && recent.length > 0 ? (
              <Command.Group
                heading={t("recentHeading")}
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-tertiary"
              >
                {recent.map((item) => {
                  const href = `/s/${item.spaceSlug}/${item.slug}`;
                  return (
                    <Command.Item
                      key={item.pageId}
                      value={href}
                      data-href={href}
                      onSelect={() => go(href)}
                      className={itemClass}
                    >
                      {item.icon ? (
                        <span aria-hidden className="w-4 shrink-0 text-center text-sm">
                          {item.icon}
                        </span>
                      ) : (
                        <Clock aria-hidden className="size-4 shrink-0 text-fg-tertiary" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-fg">{item.title}</span>
                        <span className="block truncate text-caption text-fg-tertiary">
                          {item.spaceName}
                        </span>
                      </span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ) : null}
          </>
        )}
      </Command.List>

      <div className="flex items-center gap-3 border-t border-edge px-4 py-2 text-caption text-fg-tertiary">
        <span className="flex items-center gap-1">
          <Kbd>{KBD_UP}</Kbd>
          <Kbd>{KBD_DOWN}</Kbd>
          <span>{t("hintSelect")}</span>
        </span>
        <span className="flex items-center gap-1">
          <Kbd>{KBD_ENTER}</Kbd>
          <span>{t("hintOpen")}</span>
        </span>
        <span className="flex items-center gap-1">
          <Kbd>⌘</Kbd>
          <Kbd>{KBD_ENTER}</Kbd>
          <span>{t("hintNewTab")}</span>
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Kbd>{KBD_ESC}</Kbd>
          <span>{t("hintClose")}</span>
        </span>
      </div>
    </Command.Dialog>
  );
}
