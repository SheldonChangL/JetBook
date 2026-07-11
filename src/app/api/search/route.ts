import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/current";
import { fullTextSearch } from "@/lib/search/fulltext";
import { semanticSearch } from "@/lib/search/semantic";

export const dynamic = "force-dynamic";

/**
 * 搜尋 API（F-SEARCH-01 全文 + I-05 語意）。薄殼：驗 session → 呼叫 lib 層（權限在 SQL 過濾）。
 * GET /api/search?q=...&space=<uuid>&mode=fulltext|semantic|hybrid
 * - mode 省略或 fulltext：pgroonga 全文搜尋（既有行為）。
 * - mode=semantic：僅向量路語意搜尋（I-01 retrieve），命中近義未含原詞的頁。
 * - mode=hybrid：全文+向量 RRF 融合。
 * semantic/hybrid 在未設定 embedding 時回空 hits（不 500；由 semanticSearch 內部把關）。
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const spaceId = url.searchParams.get("space") ?? undefined;
  const mode = url.searchParams.get("mode") ?? "fulltext";

  if (mode === "semantic" || mode === "hybrid") {
    const hits = await semanticSearch(session.user, q, { spaceId, mode });
    return NextResponse.json({ data: { hits } });
  }

  const hits = await fullTextSearch(session.user, q, { spaceId });
  return NextResponse.json({ data: { hits } });
}
