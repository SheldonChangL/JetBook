import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/current";
import { withMetrics } from "@/lib/metrics/http";
import { listRecentVisits } from "@/lib/pages/recent";

export const dynamic = "force-dynamic";

/**
 * 最近瀏覽 API（F-SEARCH-02 Cmd+K 無輸入態）。薄殼：驗 session → 呼叫 lib 層。
 * 權限在 lib 的 SQL 層以 accessibleSpaceCondition 過濾（架構鐵律 #1/#2），
 * 不做「先取回再過濾」。回傳本人最近瀏覽（page_visits）前 5 筆。
 * GET /api/recent
 */
async function handleGET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  const items = await listRecentVisits(session.user, 5);
  return NextResponse.json({ data: { items } });
}

export const GET = withMetrics("/api/recent", handleGET);
