import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { recordAiUsage } from "@/lib/ai/usage";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { seedUser } from "./helpers";

/**
 * I-06 AI 用量記錄整合測試（真 PG）：recordAiUsage → audit_logs。
 * 驗收：audit_logs 有 `ai.query` 列且含 tokens，並可按使用者／功能（mode）分項查詢。
 */
describe("recordAiUsage → audit_logs（真 PG，I-06）", () => {
  it("寫入 ai.query 列，metadata 含 model/tokens/latency/mode，可按使用者查詢", async () => {
    const user = await seedUser();

    await recordAiUsage({
      actorId: user.id,
      model: "claude-test",
      inputTokens: 128,
      outputTokens: 64,
      latencyMs: 350,
      mode: "chat",
      ip: "10.1.2.3",
    });

    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, user.id), eq(auditLogs.action, "ai.query")));

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.targetType).toBe("ai");
    expect(row.ip).toBe("10.1.2.3");
    expect(row.metadata).toMatchObject({
      model: "claude-test",
      inputTokens: 128,
      outputTokens: 64,
      latencyMs: 350,
      mode: "chat",
    });
  });

  it("同使用者不同功能（mode）各記一列，支援按功能分項統計", async () => {
    const user = await seedUser();

    await recordAiUsage({
      actorId: user.id,
      model: "llm",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 100,
      mode: "chat",
    });
    await recordAiUsage({
      actorId: user.id,
      model: "bge-m3",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 20,
      mode: "semantic",
    });

    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, user.id), eq(auditLogs.action, "ai.query")));

    const modes = rows.map((r) => (r.metadata as { mode: string }).mode).sort();
    expect(modes).toEqual(["chat", "semantic"]);
    // 用量可加總（NFR-OBS-04 成本估算）：chat 列的 output tokens 保留。
    const chatRow = rows.find((r) => (r.metadata as { mode: string }).mode === "chat");
    expect((chatRow!.metadata as { outputTokens: number }).outputTokens).toBe(5);
  });
});
