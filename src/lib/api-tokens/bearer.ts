import "server-only";
import { NextResponse } from "next/server";
import { createMemoryRateLimiter, type RateLimiter } from "@/lib/rate-limit";
import { verifyApiToken, type ApiTokenScope, type VerifiedApiToken } from ".";

/**
 * REST API v1 的 Bearer 認證薄殼（M4-06）：驗 token → 驗 scope → 每 token 限流。
 * 通過後由呼叫端以 auth.user 走既有 lib/authz——API 權限與 UI 完全一致（F-API-01 驗收 1）。
 */

const globalForApiRate = globalThis as unknown as { jetbookApiLimiter?: RateLimiter };

/** REST API：120 次/分/token（可插拔 store 原則同其他 limiter）。 */
function apiRateLimiter(): RateLimiter {
  globalForApiRate.jetbookApiLimiter ??= createMemoryRateLimiter({
    limit: 120,
    windowMs: 60_000,
  });
  return globalForApiRate.jetbookApiLimiter;
}

export type ApiAuthResult =
  | { ok: true; auth: VerifiedApiToken }
  | { ok: false; response: NextResponse };

function errorResponse(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

export async function requireApiAuth(
  request: Request,
  scope: ApiTokenScope,
): Promise<ApiAuthResult> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !match[1]) {
    return {
      ok: false,
      response: errorResponse(401, "UNAUTHORIZED", "缺少或無效的 Bearer token"),
    };
  }

  const auth = await verifyApiToken(match[1]);
  if (!auth) {
    return {
      ok: false,
      response: errorResponse(401, "UNAUTHORIZED", "token 無效、已撤銷或已過期"),
    };
  }

  if (!auth.scopes.includes(scope)) {
    return {
      ok: false,
      response: errorResponse(403, "INSUFFICIENT_SCOPE", `此操作需要 ${scope} scope`),
    };
  }

  const rate = apiRateLimiter().check(auth.tokenId);
  if (!rate.allowed) {
    return {
      ok: false,
      response: errorResponse(429, "RATE_LIMITED", "請求過於頻繁，請稍後再試", {
        "retry-after": String(rate.retryAfterSeconds),
      }),
    };
  }

  return { ok: true, auth };
}
