import { NextResponse } from "next/server";
import { requestLogger } from "@/lib/logger";
import { cookieSecure } from "@/lib/auth/session";
import {
  OIDC_BASE_PATH,
  OIDC_NONCE_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  isOidcEnabled,
  oidcProvider,
} from "@/lib/auth/oidc";

export const dynamic = "force-dynamic";

/** 授權交易 cookie 有效期（10 分鐘，僅涵蓋單次跳轉往返）。 */
const TX_COOKIE_MAX_AGE = 600;

/**
 * SSO 授權起點（B-06）。薄殼：feature flag 關閉即 404；否則呼叫 lib 產生授權請求，
 * 將 state/nonce/PKCE verifier 寫入短效 HttpOnly cookie（限 SSO 路徑），再導向 IdP。
 * GET /api/auth/oidc/authorize。
 */
export async function GET(request: Request) {
  if (!isOidcEnabled()) {
    return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  const log = requestLogger(new Headers(request.headers));
  try {
    const { authorizationUrl, state, nonce, codeVerifier } =
      await oidcProvider.createAuthorizationRequest();

    const response = NextResponse.redirect(authorizationUrl);
    const cookieOptions = {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "lax" as const,
      path: OIDC_BASE_PATH,
      maxAge: TX_COOKIE_MAX_AGE,
    };
    response.cookies.set(OIDC_STATE_COOKIE, state, cookieOptions);
    response.cookies.set(OIDC_NONCE_COOKIE, nonce, cookieOptions);
    response.cookies.set(OIDC_VERIFIER_COOKIE, codeVerifier, cookieOptions);
    return response;
  } catch (error) {
    log.error({ error }, "oidc authorize failed");
    return NextResponse.redirect(new URL("/login?error=sso", request.url));
  }
}
