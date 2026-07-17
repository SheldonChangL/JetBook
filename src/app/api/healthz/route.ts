import { NextResponse } from "next/server";
import { getBuildInfo } from "@/lib/build-info-server";

export const dynamic = "force-dynamic";

/**
 * Liveness：程序活著即回 200，不觸碰 DB（供 K8s liveness probe 沿用）。
 * 附帶 build 版本／commit（#267），供部署腳本 `curl` 程式化確認上線版本。
 */
export function GET() {
  const build = getBuildInfo();
  return NextResponse.json({ status: "ok", version: build.version, commit: build.commit });
}
