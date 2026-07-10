import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/current";
import { fullTextSearch } from "@/lib/search/fulltext";

export const dynamic = "force-dynamic";

/**
 * 全文搜尋 API（F-SEARCH-01）。薄殼：驗 session → 呼叫 lib 層（權限在 SQL 過濾）。
 * GET /api/search?q=...&space=<uuid>
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const spaceId = url.searchParams.get("space") ?? undefined;

  const hits = await fullTextSearch(session.user, q, { spaceId });
  return NextResponse.json({ data: { hits } });
}
