import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-tokens/bearer";
import { fullTextSearch } from "@/lib/search/fulltext";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/search?q=&limit=：全文搜尋（M4-06）。
 * 權限：fullTextSearch 於 SQL 層以 getAccessiblePageIds 過濾（與 UI 完全一致）。
 */
export async function GET(request: Request) {
  const result = await requireApiAuth(request, "read");
  if (!result.ok) return result.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json(
      { error: { code: "INVALID_QUERY", message: "缺少查詢參數 q" } },
      { status: 400 },
    );
  }
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

  const hits = await fullTextSearch(result.auth.user, q, { limit });
  return NextResponse.json({
    data: hits.map((h) => ({
      pageId: h.pageId,
      title: h.title,
      icon: h.icon,
      slug: h.slug,
      spaceSlug: h.spaceSlug,
      spaceName: h.spaceName,
      snippet: h.snippet,
      score: h.score,
    })),
  });
}
