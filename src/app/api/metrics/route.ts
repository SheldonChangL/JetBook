import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { registry } from "@/lib/metrics/registry";
import { collectQueueDepth } from "@/lib/metrics/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Prometheus 抓取端點（N-05，NFR-OBS-03/04）。薄殼：驗 token → 刷新即時指標 → 輸出。
 *
 * 設計限內網（無 session；已在 middleware PUBLIC_PATHS 放行）：
 * - 設定 `METRICS_TOKEN` 後，須帶 `Authorization: Bearer <token>`，否則 401（constant-time 比對）。
 * - 未設定 METRICS_TOKEN 則不驗（信任內網／反向代理層限制來源）。
 *
 * GET /api/metrics → text/plain（prom exposition format）。
 */
export async function GET(request: Request): Promise<Response> {
  if (env.METRICS_TOKEN && !isAuthorized(request, env.METRICS_TOKEN)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  // pg-boss 佇列深度為即時查詢，抓取當下刷新；其餘（HTTP/LLM/process）為累積式，直接輸出。
  await collectQueueDepth();

  const body = await registry.metrics();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": registry.contentType,
      "Cache-Control": "no-store",
    },
  });
}

/** constant-time 比對 Bearer token（長度不符直接 false，避免長度側信道與 timingSafeEqual 擲例外）。 */
function isAuthorized(request: Request, expected: string): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length);
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}
