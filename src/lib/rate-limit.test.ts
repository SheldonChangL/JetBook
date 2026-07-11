import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiRateLimiter, createMemoryRateLimiter } from "./rate-limit";

describe("createMemoryRateLimiter（sliding window）", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("窗內放行至上限，超限拒絕並附建議重試秒數", () => {
    const limiter = createMemoryRateLimiter({ limit: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      expect(limiter.check("k").allowed).toBe(true);
    }
    const blocked = limiter.check("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("不同 key 各自獨立計數", () => {
    const limiter = createMemoryRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    // b 全新，不受 a 影響。
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("窗滑動後（最舊事件過期）重新放行", () => {
    const limiter = createMemoryRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);
    // 前進超過一個窗口 → 舊事件全部過期。
    vi.advanceTimersByTime(60_001);
    expect(limiter.check("k").allowed).toBe(true);
  });
});

describe("aiRateLimiter（NFR-SEC-07：20 次/分/使用者）", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("同一使用者連打第 21 次被拒（20 放行、21 → 429 條件）", () => {
    // 以獨特 key 隔離全域單例，避免與其他測試互相影響。
    const key = `it-user-${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < 20; i++) {
      expect(aiRateLimiter.check(key).allowed).toBe(true);
    }
    const twentyFirst = aiRateLimiter.check(key);
    expect(twentyFirst.allowed).toBe(false);
    expect(twentyFirst.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
