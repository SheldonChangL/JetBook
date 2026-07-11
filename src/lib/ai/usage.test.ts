import { beforeEach, describe, expect, it, vi } from "vitest";

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...args),
}));

import { recordAiUsage } from "./usage";

beforeEach(() => vi.clearAllMocks());

describe("recordAiUsage", () => {
  it("以 action=ai.query / targetType=ai 寫入，metadata 帶 model/tokens/latency/mode", async () => {
    await recordAiUsage({
      actorId: "u1",
      model: "gpt-x",
      inputTokens: 12,
      outputTokens: 3,
      latencyMs: 88,
      mode: "chat",
      ip: "1.2.3.4",
    });
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith({
      actorId: "u1",
      action: "ai.query",
      targetType: "ai",
      metadata: { model: "gpt-x", inputTokens: 12, outputTokens: 3, latencyMs: 88, mode: "chat" },
      ip: "1.2.3.4",
    });
  });

  it("ip 省略時以 null 寫入", async () => {
    await recordAiUsage({
      actorId: "u",
      model: "bge-m3",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 5,
      mode: "semantic",
    });
    expect((writeAudit.mock.calls[0]![0] as { ip: unknown }).ip).toBeNull();
  });
});
