import { NextResponse } from "next/server";
import { checkDatabase } from "@/lib/health";
import { requestLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Readiness：驗證 DB 連線，失敗回 503（供 compose healthcheck 與 K8s readiness probe）。 */
export async function GET(request: Request) {
  const log = requestLogger(new Headers(request.headers));
  const database = await checkDatabase();
  if (database.status === "ok") {
    return NextResponse.json({ status: "ready" });
  }
  log.error({ err: database.detail }, "readyz: database unreachable");
  return NextResponse.json({ status: "unavailable", reason: "database" }, { status: 503 });
}
