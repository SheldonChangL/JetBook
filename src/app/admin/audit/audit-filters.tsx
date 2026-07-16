"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ListFilter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface AuditFilterInitial {
  actions: string[];
  actor: string;
  from: string;
  to: string;
}

/**
 * 稽核日誌過濾列（L-04）：時間範圍（from/to）＋ action 多選 ＋ actor 搜尋。
 * 所有欄位為本地狀態，[套用] 時一次寫入 URL query（並清掉游標＝回到第一頁）；
 * 資料查詢在 server（page.tsx 依 URL 過濾），本元件只負責收集條件與導航。
 */
export function AuditFilters({
  availableActions,
  initial,
}: {
  availableActions: string[];
  initial: AuditFilterInitial;
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [actor, setActor] = useState(initial.actor);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial.actions));
  const [actionsOpen, setActionsOpen] = useState(false);

  function toggleAction(action: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(action)) next.delete(action);
      else next.add(action);
      return next;
    });
  }

  function apply(event?: FormEvent) {
    event?.preventDefault();
    const params = new URLSearchParams();
    if (actor.trim() !== "") params.set("actor", actor.trim());
    if (from !== "") params.set("from", from);
    if (to !== "") params.set("to", to);
    if (selected.size > 0) params.set("actions", [...selected].join(","));
    const query = params.toString();
    startTransition(() => {
      router.push(query === "" ? "/admin/audit" : `/admin/audit?${query}`);
    });
  }

  function clearAll() {
    setActor("");
    setFrom("");
    setTo("");
    setSelected(new Set());
    startTransition(() => {
      router.push("/admin/audit");
    });
  }

  const hasFilters =
    actor.trim() !== "" || from !== "" || to !== "" || selected.size > 0;

  const fieldClass =
    "h-9 rounded-sm border border-edge-strong bg-base px-3 text-body-ui text-fg placeholder:text-fg-tertiary transition-colors focus-visible:border-primary focus-visible:outline-none";

  return (
    <form
      onSubmit={apply}
      className="flex flex-wrap items-end gap-3 rounded-md border border-edge bg-raised p-3"
    >
      {/* actor 搜尋 */}
      <label className="flex min-w-[200px] flex-1 flex-col gap-1">
        <span className="text-caption text-fg-tertiary">{t("auditFilterActor")}</span>
        <span className="relative flex items-center">
          <Search aria-hidden className="pointer-events-none absolute left-3 size-4 text-fg-tertiary" />
          <input
            type="search"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder={t("auditFilterActorPlaceholder")}
            className={`${fieldClass} w-full pl-9`}
          />
        </span>
      </label>

      {/* action 多選 */}
      <div className="flex flex-col gap-1">
        <span className="text-caption text-fg-tertiary">{t("auditFilterAction")}</span>
        <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-9 min-w-[160px] items-center justify-between gap-2 rounded-sm border border-edge-strong bg-base px-3 text-body-ui text-fg transition-colors hover:bg-hover"
            >
              <span className="flex items-center gap-1.5">
                <ListFilter aria-hidden className="size-4 text-fg-tertiary" />
                {selected.size > 0
                  ? t("auditFilterActionCount", { count: selected.size })
                  : t("auditFilterActionAll")}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-72 w-64 overflow-y-auto p-1">
            {availableActions.length === 0 ? (
              <p className="px-3 py-2 text-body-ui text-fg-tertiary">{t("auditFilterActionEmpty")}</p>
            ) : (
              availableActions.map((action) => {
                const checked = selected.has(action);
                return (
                  <button
                    key={action}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleAction(action)}
                    className="flex w-full cursor-default items-center gap-2 rounded-xs px-2 py-1.5 text-left text-body-ui text-fg hover:bg-hover"
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded-xs border ${
                        checked
                          ? "border-primary bg-primary text-on-primary"
                          : "border-edge-strong"
                      }`}
                    >
                      {checked ? <Check aria-hidden className="size-3" /> : null}
                    </span>
                    <span className="truncate font-mono text-caption">{action}</span>
                  </button>
                );
              })
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* 時間範圍 */}
      <label className="flex flex-col gap-1">
        <span className="text-caption text-fg-tertiary">{t("auditFilterFrom")}</span>
        <input
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-fg-tertiary">{t("auditFilterTo")}</span>
        <input
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={fieldClass}
        />
      </label>

      <div className="flex items-center gap-2">
        <Button type="submit" size="md" loading={pending}>
          {t("auditFilterApply")}
        </Button>
        {hasFilters ? (
          <Button type="button" variant="ghost" size="md" disabled={pending} onClick={clearAll}>
            <X aria-hidden className="size-4" />
            {t("auditFilterClear")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
