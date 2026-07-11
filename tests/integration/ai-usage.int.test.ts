import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { AI_QUERY_AUDIT_ACTION, getAiUsageDaily } from "@/lib/admin/ai-usage";
import { seedUser } from "./helpers";

/**
 * L-03 AI 用量聚合整合測試（真 PG，N-01）。
 * 直接寫入 `ai.query` 稽核事件（I-06 的寫入契約：metadata 帶 input/outputTokens），
 * 驗證：按曆日聚合次數／tokens、非 ai 事件排除、逾 30 日排除、缺 outputTokens 容錯。
 * 以「插入前後差值」斷言，對既有資料免疫（不假設資料庫為空）。
 */

const MS_PER_DAY = 86_400_000;
const TIMEZONE = "Asia/Taipei";

function taipeiDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(instant);
}

/** 於指定日／集合中找該日的統計；缺該日回 0（連續序列理論上必含）。 */
function dayStat(days: { date: string; count: number; tokens: number }[], date: string) {
  const found = days.find((d) => d.date === date);
  return { count: found?.count ?? 0, tokens: found?.tokens ?? 0 };
}

describe("getAiUsageDaily（近 30 日 ai.query 聚合 · 真 PG）", () => {
  it("按曆日聚合次數與 tokens；排除非 ai 事件與逾期事件；缺 outputTokens 以 0 計", async () => {
    const actor = await seedUser();
    const now = new Date();
    const today = taipeiDate(now);
    const yesterday = taipeiDate(new Date(now.getTime() - MS_PER_DAY));

    const before = await getAiUsageDaily(30);

    await db.insert(auditLogs).values([
      // 今日：兩筆 ai.query → 次數 +2、tokens +160（150 + 10）
      {
        actorId: actor.id,
        action: AI_QUERY_AUDIT_ACTION,
        targetType: "ai",
        metadata: { inputTokens: 100, outputTokens: 50 },
        createdAt: now,
      },
      {
        actorId: actor.id,
        action: AI_QUERY_AUDIT_ACTION,
        targetType: "ai",
        // 缺 outputTokens → 以 0 計，tokens = 10
        metadata: { inputTokens: 10 },
        createdAt: now,
      },
      // 昨日：一筆 ai.query → 次數 +1、tokens +10
      {
        actorId: actor.id,
        action: AI_QUERY_AUDIT_ACTION,
        targetType: "ai",
        metadata: { inputTokens: 5, outputTokens: 5 },
        createdAt: new Date(now.getTime() - MS_PER_DAY),
      },
      // 非 ai 事件（action 過濾應排除，即使 metadata 含 token 欄位）
      {
        actorId: actor.id,
        action: "space.create",
        targetType: "space",
        metadata: { inputTokens: 9999, outputTokens: 9999 },
        createdAt: now,
      },
      // 逾 30 日（時間窗外，應排除）
      {
        actorId: actor.id,
        action: AI_QUERY_AUDIT_ACTION,
        targetType: "ai",
        metadata: { inputTokens: 1000, outputTokens: 1000 },
        createdAt: new Date(now.getTime() - 40 * MS_PER_DAY),
      },
    ]);

    const after = await getAiUsageDaily(30);

    // 連續序列涵蓋 30 日、升冪、末日為今日（台北）。
    expect(after.days).toHaveLength(30);
    expect(after.days[after.days.length - 1]?.date).toBe(today);
    for (let i = 1; i < after.days.length; i++) {
      expect(after.days[i]!.date > after.days[i - 1]!.date).toBe(true);
    }

    // 總計差值：+3 次、+170 tokens（非 ai 與逾期事件不計）。
    expect(after.totalCount - before.totalCount).toBe(3);
    expect(after.totalTokens - before.totalTokens).toBe(170);

    // 今日桶：+2 次、+160 tokens。
    const todayBefore = dayStat(before.days, today);
    const todayAfter = dayStat(after.days, today);
    expect(todayAfter.count - todayBefore.count).toBe(2);
    expect(todayAfter.tokens - todayBefore.tokens).toBe(160);

    // 昨日桶：+1 次、+10 tokens。
    const yBefore = dayStat(before.days, yesterday);
    const yAfter = dayStat(after.days, yesterday);
    expect(yAfter.count - yBefore.count).toBe(1);
    expect(yAfter.tokens - yBefore.tokens).toBe(10);
  });
});
