import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

// 固定基準時間：2026-07-10（五）14:30 本地時間
const NOW = new Date(2026, 6, 10, 14, 30, 0);

function minutesBefore(min: number): Date {
  return new Date(NOW.getTime() - min * 60_000);
}

describe("relativeTime 分類", () => {
  it("未滿 1 分鐘（含未來時間）→ justNow", () => {
    expect(relativeTime(minutesBefore(0), NOW)).toEqual({ kind: "justNow" });
    expect(relativeTime(minutesBefore(-5), NOW)).toEqual({ kind: "justNow" });
    expect(relativeTime(new Date(NOW.getTime() - 59_000), NOW)).toEqual({ kind: "justNow" });
  });

  it("1–59 分鐘 → minutesAgo", () => {
    expect(relativeTime(minutesBefore(1), NOW)).toEqual({ kind: "minutesAgo", minutes: 1 });
    expect(relativeTime(minutesBefore(59), NOW)).toEqual({ kind: "minutesAgo", minutes: 59 });
  });

  it("今天且滿 60 分鐘 → hoursAgo", () => {
    expect(relativeTime(minutesBefore(60), NOW)).toEqual({ kind: "hoursAgo", hours: 1 });
    // 今天 00:15 → 14 小時前
    expect(relativeTime(new Date(2026, 6, 10, 0, 15), NOW)).toEqual({
      kind: "hoursAgo",
      hours: 14,
    });
  });

  it("昨天（日曆日）→ yesterday", () => {
    expect(relativeTime(new Date(2026, 6, 9, 23, 59), NOW)).toEqual({ kind: "yesterday" });
    expect(relativeTime(new Date(2026, 6, 9, 0, 0), NOW)).toEqual({ kind: "yesterday" });
  });

  it("跨日未滿 1 小時仍以分鐘計（00:20 看 23:50）", () => {
    const midnightNow = new Date(2026, 6, 10, 0, 20, 0);
    expect(relativeTime(new Date(2026, 6, 9, 23, 50), midnightNow)).toEqual({
      kind: "minutesAgo",
      minutes: 30,
    });
  });

  it("前天以前同年 → 「M月D日」", () => {
    const r = relativeTime(new Date(2026, 6, 8, 12, 0), NOW);
    expect(r).toEqual({ kind: "date", label: "7月8日" });
  });

  it("跨年 → 含年份日期", () => {
    const r = relativeTime(new Date(2025, 11, 31, 12, 0), NOW);
    expect(r.kind).toBe("date");
    if (r.kind === "date") {
      expect(r.label).toContain("2025");
    }
  });
});
