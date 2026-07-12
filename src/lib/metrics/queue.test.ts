import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("@/lib/db", () => ({ db: { execute: (...args: unknown[]) => execute(...args) } }));

const warn = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { warn: (...args: unknown[]) => warn(...args) } }));

import { collectQueueDepth } from "./queue";
import { metrics } from "./registry";

/** 取某 queue/state 的佇列深度 gauge 值。 */
function gaugeValue(text: string, queue: string, state: string): number | null {
  const re = new RegExp(
    `jetbook_pgboss_jobs\\{[^}]*queue="${queue}"[^}]*state="${state}"[^}]*\\}\\s+(\\d+)`,
  );
  const match = text.match(re);
  return match ? Number(match[1]) : null;
}

describe("metrics/queue collectQueueDepth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("依 pgboss.job 分組計數刷新 gauge", async () => {
    execute.mockResolvedValue({
      rows: [
        { name: "embed-page", state: "active", count: 3 },
        { name: "embed-page", state: "created", count: 5 },
        { name: "import-zip", state: "completed", count: 1 },
      ],
    });

    await collectQueueDepth();

    const text = await metrics.registry.metrics();
    expect(gaugeValue(text, "embed-page", "active")).toBe(3);
    expect(gaugeValue(text, "embed-page", "created")).toBe(5);
    expect(gaugeValue(text, "import-zip", "completed")).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("再次刷新時清除消失的組合（reset 後重設）", async () => {
    execute.mockResolvedValueOnce({
      rows: [{ name: "embed-page", state: "active", count: 3 }],
    });
    await collectQueueDepth();

    execute.mockResolvedValueOnce({ rows: [] });
    await collectQueueDepth();

    const text = await metrics.registry.metrics();
    expect(gaugeValue(text, "embed-page", "active")).toBeNull();
  });

  it("DB／pgboss schema 不可用時記 warn 且不擲出（其餘指標照常輸出）", async () => {
    execute.mockRejectedValue(new Error('relation "pgboss.job" does not exist'));

    await expect(collectQueueDepth()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);

    // metrics 端點仍可輸出（不因佇列查詢失敗而中斷）。
    const text = await metrics.registry.metrics();
    expect(text).toContain("# TYPE jetbook_pgboss_jobs gauge");
  });
});
