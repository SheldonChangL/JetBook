import { beforeEach, describe, expect, it } from "vitest";
import { observeHttpRequest, withMetrics } from "./http";
import { metrics } from "./registry";

/** 取某 route/status 的 http 請求計數（histogram _count 樣本）。 */
async function httpCount(route: string, status: string): Promise<number> {
  const text = await metrics.registry.metrics();
  const re = new RegExp(
    `jetbook_http_request_duration_seconds_count\\{[^}]*route="${route.replace(/[/]/g, "\\/")}"[^}]*status="${status}"[^}]*\\}\\s+(\\d+)`,
  );
  const match = text.match(re);
  return match ? Number(match[1]) : 0;
}

describe("metrics/http", () => {
  beforeEach(() => {
    metrics.httpRequestDuration.reset();
  });

  it("withMetrics 記錄成功回應的狀態碼與延遲", async () => {
    const handler = withMetrics("/api/ok", async () => new Response("ok", { status: 200 }));
    const res = await handler(new Request("http://localhost/api/ok"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(await httpCount("/api/ok", "200")).toBe(1);
  });

  it("依實際回應狀態碼分項（403 與 200 各自計數）", async () => {
    const handler = withMetrics("/api/multi", async (req: Request) => {
      const denied = new URL(req.url).searchParams.get("deny") === "1";
      return new Response(null, { status: denied ? 403 : 200 });
    });
    await handler(new Request("http://localhost/api/multi?deny=1"));
    await handler(new Request("http://localhost/api/multi"));

    expect(await httpCount("/api/multi", "403")).toBe(1);
    expect(await httpCount("/api/multi", "200")).toBe(1);
  });

  it("透傳額外參數（如 route params context）", async () => {
    const handler = withMetrics(
      "/api/files/[id]",
      async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
        const { id } = await ctx.params;
        return new Response(id, { status: 200 });
      },
    );
    const res = await handler(new Request("http://localhost/api/files/x"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(await res.text()).toBe("abc");
    expect(await httpCount("/api/files/\\[id\\]", "200")).toBe(1);
  });

  it("handler 擲例外時記為 500 並原樣拋出", async () => {
    const boom = new Error("boom");
    const handler = withMetrics("/api/throw", async () => {
      throw boom;
    });
    await expect(handler(new Request("http://localhost/api/throw"))).rejects.toBe(boom);
    expect(await httpCount("/api/throw", "500")).toBe(1);
  });

  it("observeHttpRequest 未知 method 歸一為 OTHER（避免 label 基數失控）", async () => {
    observeHttpRequest({ method: "PROPFIND", route: "/api/x", status: 200, durationSeconds: 0.01 });
    const text = await metrics.registry.metrics();
    expect(text).toContain('method="OTHER"');
    expect(text).not.toContain('method="PROPFIND"');
  });
});
