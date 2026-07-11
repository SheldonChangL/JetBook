import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 搜尋 route 薄殼測試：只 mock 邊界（session/search lib/embedding 設定/限流/用量/i18n），
 * 驗證 fulltext 不限流不計用量、semantic/hybrid 限流（429）與用量記錄（I-06）。
 */

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

const getCurrentSession = vi.fn();
vi.mock("@/lib/auth/current", () => ({
  getCurrentSession: () => getCurrentSession(),
}));

const fullTextSearch = vi.fn();
vi.mock("@/lib/search/fulltext", () => ({
  fullTextSearch: (...args: unknown[]) => fullTextSearch(...args),
}));

const semanticSearch = vi.fn();
vi.mock("@/lib/search/semantic", () => ({
  semanticSearch: (...args: unknown[]) => semanticSearch(...args),
}));

const isEmbeddingConfigured = vi.fn();
const getEmbeddingProvider = vi.fn();
vi.mock("@/lib/llm", () => ({
  isEmbeddingConfigured: () => isEmbeddingConfigured(),
  getEmbeddingProvider: () => getEmbeddingProvider(),
}));

const aiRateCheck = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  aiRateLimiter: { check: (...args: unknown[]) => aiRateCheck(...args) },
}));

const recordAiUsage = vi.fn();
vi.mock("@/lib/ai/usage", () => ({
  recordAiUsage: (...args: unknown[]) => recordAiUsage(...args),
}));

vi.mock("@/lib/audit", () => ({
  ipFromHeaders: () => "9.9.9.9",
}));

import { GET } from "./route";

function get(qs: string): Request {
  return new Request(`http://localhost/api/search${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentSession.mockResolvedValue({ user: { id: "user-1", orgRole: "member" } });
  aiRateCheck.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  isEmbeddingConfigured.mockReturnValue(true);
  getEmbeddingProvider.mockReturnValue({ model: "bge-m3", dimensions: 1024, embed: vi.fn() });
  fullTextSearch.mockResolvedValue([{ pageId: "p1" }]);
  semanticSearch.mockResolvedValue([{ pageId: "p2" }]);
});

describe("GET /api/search", () => {
  it("未登入回 401", async () => {
    getCurrentSession.mockResolvedValue(null);
    const res = await GET(get("?q=abc"));
    expect(res.status).toBe(401);
  });

  it("fulltext（預設 mode）：走全文搜尋，不限流、不記用量", async () => {
    const res = await GET(get("?q=abc"));
    expect(res.status).toBe(200);
    expect(fullTextSearch).toHaveBeenCalledTimes(1);
    expect(semanticSearch).not.toHaveBeenCalled();
    expect(aiRateCheck).not.toHaveBeenCalled();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it("semantic 超限回 429 + Retry-After，且不執行檢索", async () => {
    aiRateCheck.mockReturnValue({ allowed: false, retryAfterSeconds: 30 });
    const res = await GET(get("?q=abc&mode=semantic"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    expect(aiRateCheck).toHaveBeenCalledWith("user-1");
    expect(semanticSearch).not.toHaveBeenCalled();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it("semantic 放行：檢索並記一筆 ai.query（mode=semantic、embedding model、tokens 0）", async () => {
    const res = await GET(get("?q=abc&mode=semantic"));
    expect(res.status).toBe(200);
    expect(semanticSearch).toHaveBeenCalledTimes(1);
    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(recordAiUsage.mock.calls[0]![0]).toMatchObject({
      actorId: "user-1",
      model: "bge-m3",
      inputTokens: 0,
      outputTokens: 0,
      mode: "semantic",
      ip: "9.9.9.9",
    });
    expect(typeof (recordAiUsage.mock.calls[0]![0] as { latencyMs: unknown }).latencyMs).toBe(
      "number",
    );
  });

  it("hybrid 放行：以 mode=hybrid 記用量", async () => {
    await GET(get("?q=abc&mode=hybrid"));
    expect(recordAiUsage.mock.calls[0]![0]).toMatchObject({ mode: "hybrid" });
  });

  it("semantic 但 embedding 未設定：不記用量（無實際 embedding 呼叫）", async () => {
    isEmbeddingConfigured.mockReturnValue(false);
    semanticSearch.mockResolvedValue([]);
    const res = await GET(get("?q=abc&mode=semantic"));
    expect(res.status).toBe(200);
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it("semantic 空查詢：仍計入限流但不記用量", async () => {
    const res = await GET(get("?mode=semantic&q=%20%20"));
    expect(res.status).toBe(200);
    expect(aiRateCheck).toHaveBeenCalledTimes(1);
    expect(recordAiUsage).not.toHaveBeenCalled();
  });
});
