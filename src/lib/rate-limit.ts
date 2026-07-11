import "server-only";

/**
 * Rate limiter 可插拔介面（NFR-SEC-07）。
 * 預設 in-memory sliding window——單副本正確；K8s 多副本時換成
 * DB/Redis 實作只需替換 factory，呼叫端不動（K8s 準備事項）。
 */
export interface RateLimiter {
  /** 回傳是否放行；不放行時附帶建議重試秒數 */
  check(key: string): { allowed: boolean; retryAfterSeconds: number };
}

interface WindowEntry {
  timestamps: number[];
}

export function createMemoryRateLimiter(options: {
  limit: number;
  windowMs: number;
}): RateLimiter {
  const entries = new Map<string, WindowEntry>();

  return {
    check(key: string) {
      const now = Date.now();
      const cutoff = now - options.windowMs;
      const entry = entries.get(key) ?? { timestamps: [] };
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

      if (entry.timestamps.length >= options.limit) {
        const oldest = entry.timestamps[0] ?? now;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000)),
        };
      }

      entry.timestamps.push(now);
      entries.set(key, entry);

      // 簡易記憶體回收：條目過多時清掉整窗過期者
      if (entries.size > 10_000) {
        for (const [k, v] of entries) {
          if (v.timestamps.every((t) => t <= cutoff)) entries.delete(k);
        }
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

const globalForRateLimit = globalThis as unknown as {
  jetbookLoginLimiter?: RateLimiter;
  jetbookPasswordResetLimiter?: RateLimiter;
  jetbookAiLimiter?: RateLimiter;
};

/** 登入端點：5 次/分/IP（NFR-SEC-07）。 */
export const loginRateLimiter: RateLimiter =
  globalForRateLimit.jetbookLoginLimiter ??
  (globalForRateLimit.jetbookLoginLimiter = createMemoryRateLimiter({
    limit: 5,
    windowMs: 60_000,
  }));

/** 忘記密碼端點：5 次/分/IP，防濫發重設信件轟炸（B-05）。 */
export const passwordResetRateLimiter: RateLimiter =
  globalForRateLimit.jetbookPasswordResetLimiter ??
  (globalForRateLimit.jetbookPasswordResetLimiter = createMemoryRateLimiter({
    limit: 5,
    windowMs: 60_000,
  }));

/**
 * AI 端點：20 次/分/使用者（NFR-SEC-07、I-06）。key 為 user id，
 * 涵蓋 /api/ai/chat 與語意／hybrid 搜尋，避免單一使用者濫用昂貴的 LLM／embedding 呼叫。
 */
export const aiRateLimiter: RateLimiter =
  globalForRateLimit.jetbookAiLimiter ??
  (globalForRateLimit.jetbookAiLimiter = createMemoryRateLimiter({
    limit: 20,
    windowMs: 60_000,
  }));
