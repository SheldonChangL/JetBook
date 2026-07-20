"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Command } from "cmdk";
import { ArrowRight, Clock, Command as CommandIcon, FileText, Search, Sparkles } from "lucide-react";
import type { SearchHit } from "@/lib/search/fulltext";
import type { SemanticHit } from "@/lib/search/semantic";
import { createAskAiEvent } from "@/lib/ai/ask-ai-event";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";

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
  /** AI 生成已設定（isLlmConfigured）：「✦ 問 AI」列據此啟用，否則停用。 */
  llmConfigured?: boolean;
  /** 語意索引已設定（isEmbeddingConfigured）：語意相關區據此渲染，否則不出現。 */
  embeddingConfigured?: boolean;
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
 * - 全文區下方為「語意相關 ✦」區（I-05）：embeddingConfigured 時渲染，400ms debounce 打
 *   /api/search?mode=semantic，載入中以固定高度骨架佔位（防面板抖動），命中近義未含原詞的頁。
 * - 「✦ 問 AI」列於 llmConfigured 時啟用 → dispatch ask-ai 事件開 AI 抽屜並預帶問題（I-03 接手）；
 *   未設定時停用。「顯示全部」導向 /search?q=（F-SEARCH-03）。
 */
export function CommandPalette({
  open,
  onOpenChange,
  llmConfigured = false,
  embeddingConfigured = false,
}: CommandPaletteProps) {
  const t = useTranslations("commandPalette");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [semanticHits, setSemanticHits] = useState<SemanticHit[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticError, setSemanticError] = useState(false);

  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  const lastExternalFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  openRef.current = open;
  onOpenChangeRef.current = onOpenChange;

  // cmdk 的受控 Dialog 沒有實體 Trigger；由頂列按鈕或全域快捷鍵開啟時，
  // Radix 無法自行知道關閉後應把焦點還給誰。持續記住工作層外最後聚焦的元素，
  // 並在關閉後還原，確保 Esc／再次按快捷鍵的鍵盤旅程不會掉回 body。
  useEffect(() => {
    function rememberExternalFocus(event: FocusEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && !target.closest(".archive-command-layer")) {
        lastExternalFocusRef.current = target;
      }
    }

    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      lastExternalFocusRef.current = active;
    }
    document.addEventListener("focusin", rememberExternalFocus);
    return () => document.removeEventListener("focusin", rememberExternalFocus);
  }, []);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!wasOpen || open) return;

    const target = lastExternalFocusRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

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
      setSemanticHits([]);
      setSemanticError(false);
      setSemanticLoading(false);
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

  // 語意相關區（I-05）：僅在 embedding 已設定時取。400ms debounce（晚於全文 250ms，
  // 讓全文結果先落定、語意結果隨後補上）；載入中以骨架佔位。失敗靜默降級（AI 為輔助，
  // 不影響全文搜尋，NFR-AVAIL-02）。無輸入時清空。
  useEffect(() => {
    if (!open || !embeddingConfigured) return;
    const q = query.trim();
    if (q === "") {
      setSemanticHits([]);
      setSemanticLoading(false);
      setSemanticError(false);
      return;
    }

    const ctrl = new AbortController();
    setSemanticLoading(true);
    setSemanticError(false);
    const id = setTimeout(() => {
      fetch(`/api/search?mode=semantic&q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => {
          if (!r.ok) throw new Error("semantic search failed");
          return r.json();
        })
        .then((j) => {
          setSemanticHits(j.data?.hits ?? []);
          setSemanticLoading(false);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          setSemanticError(true);
          setSemanticLoading(false);
        });
    }, 400);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [open, query, embeddingConfigured]);

  const trimmed = query.trim();
  const showAi = trimmed.length >= 2;

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  // 「✦ 問 AI」：關面板 → dispatch ask-ai 事件（AI 抽屜 I-03 監聽並開啟、預帶問題）。
  function askAi() {
    if (!llmConfigured) return;
    onOpenChange(false);
    window.dispatchEvent(createAskAiEvent(trimmed));
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
    "archive-command-item flex cursor-default select-none items-center gap-3 rounded-md px-3 py-2 text-body-ui text-fg data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-60 data-[selected=true]:bg-hover";
  const statusClass = "archive-command-status px-3 py-6 text-center text-body-ui text-fg-tertiary";

  // 語意相關區標題（載入骨架與結果兩態共用，維持一致），含 ✦ 與 AI 徽章。
  const semanticHeadingEl = (
    <div className="archive-command-semantic-heading flex items-center gap-1.5 px-3 py-1.5">
      <Sparkles aria-hidden className="size-3.5 shrink-0 text-ai" />
      <span className="text-caption font-medium text-fg-tertiary">{t("semanticHeading")}</span>
      <Badge variant="ai">{t("aiBadge")}</Badge>
    </div>
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={t("label")}
      shouldFilter={false}
      loop
      onKeyDown={onKeyDown}
      overlayClassName="archive-command-overlay fixed inset-0 z-50 bg-black/40"
      contentClassName="archive-command-layer fixed left-1/2 top-[15vh] z-50 flex max-h-[70vh] w-[calc(100vw-32px)] max-w-[640px] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-raised shadow-lg"
    >
      <div className="archive-command-context">
        <span><CommandIcon aria-hidden />{t("archiveLayer")}</span>
        <span>{t(embeddingConfigured ? "archiveScopeSemantic" : "archiveScopeFullText")}</span>
        {llmConfigured ? <span>{t("archiveScopeAi")}</span> : null}
      </div>
      <div className="archive-command-input-row flex items-center gap-2 border-b border-edge px-4">
        <Search aria-hidden className="size-4 shrink-0 text-fg-tertiary" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={t("inputPlaceholder")}
          className="h-12 w-full bg-transparent text-body text-fg outline-none placeholder:text-fg-tertiary"
        />
      </div>

      <Command.List className="archive-command-list min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {showAi ? (
          <Command.Item
            value="__ask_ai__"
            disabled={!llmConfigured}
            onSelect={askAi}
            className={itemClass}
          >
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
                className="archive-command-group [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-tertiary"
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
                      {hit.icon ? (
                        <span aria-hidden className="w-4 shrink-0 text-center leading-none">
                          {hit.icon}
                        </span>
                      ) : (
                        <FileText aria-hidden className="size-4 shrink-0 text-fg-tertiary" />
                      )}
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
                  className="archive-command-show-all flex cursor-default select-none items-center gap-2 rounded-md px-3 py-2 text-body-ui font-medium text-primary data-[selected=true]:bg-hover"
                >
                  <span className="flex-1">{t("showAll", { count: hits.length })}</span>
                  <ArrowRight aria-hidden className="size-4 shrink-0" />
                </Command.Item>
              </Command.Group>
            ) : null}

            {/* 語意相關區（I-05）：embedding 已設定才渲染。載入中固定高度骨架佔位；
                失敗或無結果則靜默收合（不影響上方全文區）。 */}
            {embeddingConfigured && semanticLoading ? (
              <div className="mt-1">
                {semanticHeadingEl}
                <div aria-hidden className="px-3 pb-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 py-1.5">
                      <Skeleton className="size-4 shrink-0 rounded-sm" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-1/2" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {embeddingConfigured && !semanticLoading && !semanticError && semanticHits.length > 0 ? (
              <div className="mt-1">
                {semanticHeadingEl}
                {semanticHits.map((hit) => {
                  const href = `/s/${hit.spaceSlug}/${hit.slug}`;
                  return (
                    <Command.Item
                      key={`semantic-${hit.pageId}`}
                      value={`semantic:${href}`}
                      data-href={href}
                      onSelect={() => go(href)}
                      className={itemClass}
                    >
                      <Sparkles aria-hidden className="size-4 shrink-0 text-ai" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-fg">{hit.title}</span>
                        <span className="block truncate text-caption text-fg-tertiary">
                          {hit.spaceName}
                        </span>
                      </span>
                    </Command.Item>
                  );
                })}
              </div>
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
                className="archive-command-group [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-tertiary"
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

      <div className="archive-command-footer flex items-center gap-3 border-t border-edge px-4 py-2 text-caption text-fg-tertiary">
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
