import { NextResponse } from "next/server";
import { cookieSecure, createSession, SESSION_COOKIE } from "@/lib/auth/session";
import {
  OIDC_BASE_PATH,
  OIDC_NONCE_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  isOidcEnabled,
  oidcProvider,
  upsertOidcUser,
} from "@/lib/auth/oidc";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { requestLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** 清除授權交易 cookie（callback 收尾，成功或失敗都清）。 */
function clearTxCookies(response: NextResponse): void {
  const expire = { path: OIDC_BASE_PATH, maxAge: 0 };
  response.cookies.set(OIDC_STATE_COOKIE, "", expire);
  response.cookies.set(OIDC_NONCE_COOKIE, "", expire);
  response.cookies.set(OIDC_VERIFIER_COOKIE, "", expire);
}

/**
 * SSO 回呼（B-06）。薄殼：feature flag 關閉即 404；否則取回交易 cookie →
 * 交由 lib 換 token 與擷取身分 → upsert 使用者（auth_provider=oidc）→ 換發本地 session。
 * 任何失敗一律導回登入頁（不洩漏內部原因），並清除交易 cookie。
 * GET /api/auth/oidc/callback。
 */
export async function GET(request: Request) {
  if (!isOidcEnabled()) {
    return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  const log = requestLogger(new Headers(request.headers));
  const ip = ipFromHeaders(request.headers) ?? "unknown";

  const loginError = (): NextResponse => {
    const response = NextResponse.redirect(new URL("/login?error=sso", request.url));
    clearTxCookies(response);
    return response;
  };

  const currentUrl = new URL(request.url);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const readCookie = (name: string): string | undefined =>
    cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${name}=`))
      ?.slice(name.length + 1);

  const state = readCookie(OIDC_STATE_COOKIE);
  const nonce = readCookie(OIDC_NONCE_COOKIE);
  const codeVerifier = readCookie(OIDC_VERIFIER_COOKIE);

  if (!state || !nonce || !codeVerifier) {
    log.warn("oidc callback missing transaction cookies");
    return loginError();
  }

  try {
    const identity = await oidcProvider.completeAuthorization(currentUrl, {
      state,
      nonce,
      codeVerifier,
    });
    const user = await upsertOidcUser(identity);

    if (!user.isActive) {
      log.info({ userId: user.id }, "oidc login rejected: inactive user");
      await writeAudit({
        actorId: user.id,
        action: "auth.login_failed",
        targetType: "user",
        targetId: user.id,
        metadata: { provider: "oidc", reason: "inactive" },
        ip,
      });
      return loginError();
    }

    const { token, session } = await createSession(user.id, {
      ip,
      userAgent: request.headers.get("user-agent"),
    });

    const response = NextResponse.redirect(new URL("/", request.url));
    clearTxCookies(response);
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });

    log.info({ userId: user.id }, "oidc login success");
    await writeAudit({
      actorId: user.id,
      action: "auth.login",
      targetType: "user",
      targetId: user.id,
      metadata: { provider: "oidc" },
      ip,
    });
    return response;
  } catch (error) {
    log.error({ error }, "oidc callback failed");
    return loginError();
  }
}
