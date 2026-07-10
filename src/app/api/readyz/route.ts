import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requestLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Readiness：驗證 DB 連線，失敗回 503（供 compose healthcheck 與 K8s readiness probe）。 */
export async function GET(request: Request) {
  const log = requestLogger(new Headers(request.headers));
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ status: "ready" });
  } catch (error) {
    log.error({ err: error }, "readyz: database unreachable");
    return NextResponse.json({ status: "unavailable", reason: "database" }, { status: 503 });
  }
}
