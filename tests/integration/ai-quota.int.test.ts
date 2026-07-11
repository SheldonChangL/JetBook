import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { AI_QUERY_AUDIT_ACTION } from "@/lib/ai/usage";
import {
  checkAiDailyQuota,
  countAiQueriesToday,
  getAiDailyQuotaPerUser,
  setAiDailyQuotaPerUser,
} from "@/lib/ai/quota";
import { seedUser } from "./helpers";

/**
 * I-09 AI 每人每日配額整合測試（真 PG，N-01）。
 * 配額值存單列 org_settings；已用量以當日 `ai.query` 稽核事件計數推得。
 * 需精準控制 createdAt 以驗曆日邊界，故直接插入 audit_logs（recordAiUsage 只用 now()）。
 * 驗證：當日計數（只計本人／當日／ai.query）、配額 upsert 讀寫、達額（>=）即拒、null 不限。
 * org_settings 為全域單列：測試結尾回復為 null，避免影響其他測試。
 */

const MS_PER_DAY = 86_400_000;

function aiQueryRow(actorId: string, createdAt: Date) {
  return {
    actorId,
    action: AI_QUERY_AUDIT_ACTION,
    targetType: "ai",
    metadata: { model: "llm", inputTokens: 1, outputTokens: 1, latencyMs: 1, mode: "chat" },
    createdAt,
  };
}

afterAll(async () => {
  // 回復不限，避免全域單列設定殘留影響其他測試檔。
  await setAiDailyQuotaPerUser(null);
});

describe("AI 每人每日配額（真 PG）", () => {
  it("countAiQueriesToday：只計本人、當日、ai.query 事件", async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const now = new Date();
    const yesterday = new Date(now.getTime() - MS_PER_DAY);

    await db.insert(auditLogs).values([
      // userA 今日兩筆 ai.query → 計 2
      aiQueryRow(userA.id, now),
      aiQueryRow(userA.id, now),
      // userA 昨日一筆（曆日邊界外，不計）
      aiQueryRow(userA.id, yesterday),
      // userA 今日非 ai.query（動作過濾，不計）
      {
        actorId: userA.id,
        action: "space.create",
        targetType: "space",
        metadata: { mode: "chat" },
        createdAt: now,
      },
      // userB 今日一筆（他人，不計入 A）
      aiQueryRow(userB.id, now),
    ]);

    // 新種子使用者先前無事件 → 可直接斷言絕對值。
    expect(await countAiQueriesToday(userA.id)).toBe(2);
    expect(await countAiQueriesToday(userB.id)).toBe(1);
  });

  it("配額讀寫：setAiDailyQuotaPerUser upsert，null 代表不限", async () => {
    await setAiDailyQuotaPerUser(5);
    expect(await getAiDailyQuotaPerUser()).toBe(5);

    // 再次寫入（同一單列 upsert，非新增列）
    await setAiDailyQuotaPerUser(10);
    expect(await getAiDailyQuotaPerUser()).toBe(10);

    await setAiDailyQuotaPerUser(null);
    expect(await getAiDailyQuotaPerUser()).toBeNull();
  });

  it("checkAiDailyQuota：quota=2 時第 3 次被拒；null 不限一律放行", async () => {
    const user = await seedUser();
    const now = new Date();

    // 不限（null）：即便已有用量也放行，且不計數（used=0）。
    await setAiDailyQuotaPerUser(null);
    await db.insert(auditLogs).values(aiQueryRow(user.id, now));
    expect(await checkAiDailyQuota(user.id)).toMatchObject({
      exceeded: false,
      quota: null,
      used: 0,
    });

    // 設 quota=2：目前已用 1（< 2）→ 放行。
    await setAiDailyQuotaPerUser(2);
    expect(await checkAiDailyQuota(user.id)).toMatchObject({ exceeded: false, quota: 2, used: 1 });

    // 第 2 筆後 used=2（>= 2）→ 達額，第 3 次請求應被拒。
    await db.insert(auditLogs).values(aiQueryRow(user.id, now));
    expect(await checkAiDailyQuota(user.id)).toMatchObject({ exceeded: true, quota: 2, used: 2 });

    // 他人不受此人用量影響（配額為每人各自計）。
    const other = await seedUser();
    expect(await checkAiDailyQuota(other.id)).toMatchObject({ exceeded: false, quota: 2, used: 0 });
  });
});
