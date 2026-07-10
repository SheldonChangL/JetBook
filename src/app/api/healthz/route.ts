import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness：程序活著即回 200，不觸碰 DB（供 K8s liveness probe 沿用）。 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
