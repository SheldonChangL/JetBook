import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 每個請求注入 x-request-id（沿用上游 proxy 傳入值，否則新生成），
 * 供 route handler / server action 的 logger 關聯同一請求的所有日誌。
 */
export function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}
