import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "jetbook_session";

/** 不需登入即可存取的路徑前綴。 */
const PUBLIC_PATHS = ["/login", "/api/healthz", "/api/readyz"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * 1) 每請求注入 x-request-id（供 logger 關聯）。
 * 2) 未帶 session cookie 的內頁請求快篩導向 /login?returnTo=…（UX 用；
 *    token 有效性驗證在 server 端 requireSession——middleware 無 DB，不能當防線）。
 */
export function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!isPublicPath(pathname) && !hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", `${pathname}${search}`);
    const response = NextResponse.redirect(loginUrl);
    response.headers.set("x-request-id", requestId);
    return response;
  }

  // 已登入者訪問 /login → 回首頁
  if (pathname === "/login" && hasSessionCookie) {
    const response = NextResponse.redirect(new URL("/", request.url));
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  // 排除靜態資源；API 與頁面都經過（request-id 對 API 也需要）
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)"],
};
