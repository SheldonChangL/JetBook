import { beforeEach, describe, expect, it, vi } from "vitest";

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...args),
}));

import { recordAiUsage } from "./usage";
import { metrics } from "@/lib/metrics/registry";

beforeEach(() => vi.clearAllMocks());

/** 取某 metric/labels 的樣本值（prom 文字格式，label 順序無關）。 */
function sample(text: string, metric: string, labels: Record<string, string>): number | null {
  const cond = Object.entries(labels)
    .map(([k, v]) => `(?=[^}]*${k}="${v.replace(/[/[\]]/g, "\\$&")}")`)
    .join("");
  const re = new RegExp(`${metric}\\{${cond}[^}]*\\}\\s+([0-9.]+)`);
  const match = text.match(re);
  return match ? Number(match[1]) : null;
}

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

  it("同步遞增 Prometheus 即時指標（requests/tokens/duration，NFR-OBS-03/04）", async () => {
    metrics.llmRequestsTotal.reset();
    metrics.llmTokensTotal.reset();
    metrics.llmRequestDuration.reset();

    await recordAiUsage({
      actorId: "u2",
      model: "usage-metric-model",
      inputTokens: 10,
      outputTokens: 4,
      latencyMs: 1500,
      mode: "chat",
    });

    const text = await metrics.registry.metrics();
    expect(sample(text, "jetbook_llm_requests_total", { mode: "chat", model: "usage-metric-model" })).toBe(1);
    expect(
      sample(text, "jetbook_llm_tokens_total", { direction: "input", model: "usage-metric-model" }),
    ).toBe(10);
    expect(
      sample(text, "jetbook_llm_tokens_total", { direction: "output", model: "usage-metric-model" }),
    ).toBe(4);
    // duration histogram：latencyMs/1000 = 1.5s 落入一次觀測。
    expect(
      sample(text, "jetbook_llm_request_duration_seconds_count", { mode: "chat", model: "usage-metric-model" }),
    ).toBe(1);
  });
});
