/**
 * 相對時間分類（Dashboard 等列表顯示「x 分鐘前／昨天／日期」用）。
 * 純函式、不含 UI 字串：分類結果由呼叫端映射 i18n 訊息（架構鐵律 #4）；
 * 僅「日期」情況直接回傳 Intl 格式化字串（日期非翻譯字串）。
 */

export type RelativeTime =
  | { kind: "justNow" }
  | { kind: "minutesAgo"; minutes: number }
  | { kind: "hoursAgo"; hours: number }
  | { kind: "yesterday" }
  | { kind: "date"; label: string };

/**
 * 分類規則：
 * - 距今 < 1 分鐘（含未來時間，容忍時鐘偏差）→ justNow
 * - < 60 分鐘 → minutesAgo
 * - 今天（日曆日）→ hoursAgo
 * - 昨天（日曆日）→ yesterday
 * - 更早：同年 → 「M月D日」；跨年 → 「YYYY年M月D日」
 */
export function relativeTime(date: Date, now: Date = new Date()): RelativeTime {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return { kind: "justNow" };
  if (minutes < 60) return { kind: "minutesAgo", minutes };

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date.getTime() >= startOfToday.getTime()) {
    return { kind: "hoursAgo", hours: Math.floor(minutes / 60) };
  }

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (date.getTime() >= startOfYesterday.getTime()) return { kind: "yesterday" };

  const sameYear = date.getFullYear() === now.getFullYear();
  const label = new Intl.DateTimeFormat(
    "zh-TW",
    sameYear ? { month: "long", day: "numeric" } : { dateStyle: "long" },
  ).format(date);
  return { kind: "date", label };
}
