"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import { markAllNotificationsRead } from "@/actions/notification";
import type { NotificationView } from "@/lib/notifications";
import { relativeTime, type RelativeTime } from "@/lib/relative-time";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * 頂部列通知鈴鐺（K-02，F-NOTIF-01）：
 * - 未讀徽章（>9 顯示 9+）；Popover 列出近期通知，點擊項目直達 payload.url。
 * - 「全部標為已讀」呼叫 server action；本機樂觀更新徽章與已讀狀態。
 * 初始資料由 (app)/layout RSC 查詢後注入，避免鈴鐺自行在 client 拉取。
 */
export function NotificationBell({
  initialItems,
  initialUnread,
}: {
  initialItems: NotificationView[];
  initialUnread: number;
}) {
  const t = useTranslations("notifications");
  const [items, setItems] = useState<NotificationView[]>(initialItems);
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  function onMarkAllRead() {
    if (unread === 0) return;
    const nowIso = new Date().toISOString();
    // 樂觀：清零徽章、未讀者補上 readAt
    setUnread(0);
    setItems((prev) => prev.map((i) => (i.readAt ? i : { ...i, readAt: nowIso })));
    startTransition(async () => {
      try {
        await markAllNotificationsRead();
      } catch {
        // 失敗回復：重算未讀數（以本機為準的近似還原）
        setUnread(initialUnread);
        setItems(initialItems);
      }
    });
  }

  const badge = unread > 9 ? t("unreadBadgeMax") : String(unread);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={unread > 0 ? t("labelWithCount", { count: unread }) : t("label")}
        className="relative inline-flex size-8 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--primary)]"
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white"
          >
            {badge}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <p className="text-body-ui font-medium text-fg">{t("heading")}</p>
          {unread > 0 ? (
            <Button variant="ghost" size="sm" onClick={onMarkAllRead}>
              {t("markAllRead")}
            </Button>
          ) : null}
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={<Bell />}
            title={t("empty")}
            className="px-4 py-8 [&>h3]:text-body-ui [&>h3]:text-fg-secondary"
          />
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.payload.url}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex gap-2 px-3 py-2.5 transition-colors hover:bg-hover",
                    item.readAt ? null : "bg-primary-tint",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      item.readAt ? "bg-transparent" : "bg-primary",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-ui text-fg">
                      <NotificationText item={item} />
                    </span>
                    {item.payload.excerpt ? (
                      <span className="mt-0.5 block truncate text-caption text-fg-tertiary">
                        {item.payload.excerpt}
                      </span>
                    ) : null}
                    <TimeAgo iso={item.createdAt} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** 依 type 與 payload 組出通知主文案（i18n）。 */
function NotificationText({ item }: { item: NotificationView }) {
  const t = useTranslations("notifications");
  const actor = item.payload.actorName ?? "";
  if (item.type === "comment_reply") {
    return item.payload.pageTitle ? (
      <>{t("commentReply", { actor, title: item.payload.pageTitle })}</>
    ) : (
      <>{t("commentReplyNoTitle", { actor })}</>
    );
  }
  if (item.type === "page_mention") {
    return item.payload.pageTitle ? (
      <>{t("pageMention", { actor, title: item.payload.pageTitle })}</>
    ) : (
      <>{t("pageMentionNoTitle", { actor })}</>
    );
  }
  return <>{t("genericEvent")}</>;
}

/** 相對時間（純客戶端計算，抑制水合落差警告）。 */
function TimeAgo({ iso }: { iso: string }) {
  const tc = useTranslations("common.relativeTime");
  const rt: RelativeTime = relativeTime(new Date(iso));
  let label: string;
  switch (rt.kind) {
    case "justNow":
      label = tc("justNow");
      break;
    case "minutesAgo":
      label = tc("minutesAgo", { minutes: rt.minutes });
      break;
    case "hoursAgo":
      label = tc("hoursAgo", { hours: rt.hours });
      break;
    case "yesterday":
      label = tc("yesterday");
      break;
    default:
      label = rt.label;
  }
  return (
    <time dateTime={iso} suppressHydrationWarning className="mt-0.5 block text-caption text-fg-tertiary">
      {label}
    </time>
  );
}
