import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route 層測試（薄殼）：只 mock 邊界（env token / 佇列刷新），走真實 prom-client Registry，
 * 驗 bearer 授權閘門、prom 文字格式輸出與 no-store 快取標頭。
 */

const h = vi.hoisted(() => ({
  env: { NODE_ENV: "test" as string, METRICS_TOKEN: undefined as string | undefined },
  collectQueueDepth: vi.fn(async () => undefined),
}));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/metrics/queue", () => ({ collectQueueDepth: h.collectQueueDepth }));

const mockEnv = h.env;
const collectQueueDepth = h.collectQueueDepth;

import { GET } from "./route";

function req(headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/metrics", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.METRICS_TOKEN = undefined;
});

describe("GET /api/metrics", () => {
  it("未設 METRICS_TOKEN：不驗，回 200 prom 格式並刷新佇列深度", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(collectQueueDepth).toHaveBeenCalledTimes(1);

    const body = await res.text();
    // 應用層指標 TYPE 行須存在（即使尚無樣本）。pgboss 佇列 gauge 的註冊由 queue.test.ts 覆蓋，
    // 本測試將 queue 模組 mock 掉以隔離 DB，故不斷言其 TYPE 行。
    expect(body).toContain("# TYPE jetbook_http_request_duration_seconds histogram");
    expect(body).toContain("# TYPE jetbook_llm_requests_total counter");
    expect(body).toContain("# TYPE jetbook_llm_tokens_total counter");
  });

  it("設 METRICS_TOKEN 但未帶 Authorization：401，且不查佇列", async () => {
    mockEnv.METRICS_TOKEN = "s3cret";
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(collectQueueDepth).not.toHaveBeenCalled();
  });

  it("設 METRICS_TOKEN 但 token 錯誤：401", async () => {
    mockEnv.METRICS_TOKEN = "s3cret";
    const res = await GET(req({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("設 METRICS_TOKEN 且 Bearer 正確：200", async () => {
    mockEnv.METRICS_TOKEN = "s3cret";
    const res = await GET(req({ authorization: "Bearer s3cret" }));
    expect(res.status).toBe(200);
    expect(collectQueueDepth).toHaveBeenCalledTimes(1);
    expect(await res.text()).toContain("jetbook_");
  });

  it("非 Bearer scheme：401", async () => {
    mockEnv.METRICS_TOKEN = "s3cret";
    const res = await GET(req({ authorization: "Basic s3cret" }));
    expect(res.status).toBe(401);
  });
});
