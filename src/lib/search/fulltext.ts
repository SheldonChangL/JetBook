import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getAccessiblePageIds, type Actor } from "@/lib/authz/permission";

export interface SearchHit {
  pageId: string;
  spaceSlug: string;
  spaceName: string;
  slug: string;
  title: string;
  /** 頁面 emoji 圖示（M4-03）；null＝未設定 */
  icon: string | null;
  /** 命中內文片段（HTML，已 pgroonga 高亮 <mark>） */
  snippet: string;
  score: number;
}

/**
 * 搜尋過濾條件（F-SEARCH-03）。權限過濾一律另走 getAccessiblePageIds，
 * 這裡的條件只在可讀集合內再收斂，永不放寬權限。
 */
export interface SearchFilters {
  /** 限定單一 Space（可讀清單其中之一）。 */
  spaceId?: string;
  /** 限定作者（頁面 created_by）。 */
  authorId?: string;
  /** 只納入最近 N 天內更新的頁面（7 / 30）；未給＝全部。 */
  updatedWithinDays?: number;
}

/**
 * 全文搜尋（F-SEARCH-01，ADR-007 pgroonga）。
 * 權限：先取可讀 pageId 集合（SQL 層過濾），再以 pgroonga `&@~` 查詢 + 分數排序。
 * 標題命中權重高於內文；回傳含 <mark> 高亮片段。
 * 過濾器（F-SEARCH-03）：Space／作者／更新時間，於主查詢的 pages 條件附加，權限過濾不變。
 */
export async function fullTextSearch(
  user: Actor,
  query: string,
  options: SearchFilters & { limit?: number } = {},
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  const accessibleIds = await getAccessiblePageIds(user, options.spaceId);
  if (accessibleIds.length === 0) return [];

  const limit = Math.min(options.limit ?? 20, 50);

  // 過濾器條件（權限之外的收斂；未給則不附加）。作者與更新時間直接作用於 pages 主查詢。
  const authorCondition = options.authorId
    ? sql`AND p.created_by = ${options.authorId}`
    : sql``;
  const updatedCondition =
    options.updatedWithinDays && options.updatedWithinDays > 0
      ? sql`AND p.updated_at >= now() - make_interval(days => ${options.updatedWithinDays})`
      : sql``;

  // pgroonga_score 以 title 命中加權 3 倍、content 命中 1 倍合併；
  // pgroonga_snippet_html 產生高亮片段。權限以 id in (...) 於 SQL 層限定。
  const rows = await db.execute<{
    page_id: string;
    space_slug: string;
    space_name: string;
    slug: string;
    title: string;
    icon: string | null;
    snippet: string;
    score: number;
  }>(sql`
    SELECT
      p.id AS page_id,
      s.slug AS space_slug,
      s.name AS space_name,
      p.slug AS slug,
      p.title AS title,
      p.icon AS icon,
      COALESCE(
        (pgroonga_snippet_html(p.content_text, pgroonga_query_extract_keywords(${q})))[1],
        left(p.content_text, 120)
      ) AS snippet,
      (
        (CASE WHEN p.title &@~ ${q} THEN 3.0 ELSE 0 END)
        + (CASE WHEN p.content_text &@~ ${q} THEN 1.0 ELSE 0 END)
      ) AS score
    FROM pages p
    JOIN spaces s ON s.id = p.space_id
    WHERE p.id IN ${sql.raw(`(${accessibleIds.map((id) => `'${id}'`).join(",")})`)}
      AND (p.title &@~ ${q} OR p.content_text &@~ ${q})
      ${authorCondition}
      ${updatedCondition}
    ORDER BY score DESC, p.updated_at DESC
    LIMIT ${limit}
  `);

  return rows.rows.map((r) => ({
    pageId: r.page_id,
    spaceSlug: r.space_slug,
    spaceName: r.space_name,
    slug: r.slug,
    title: r.title,
    icon: r.icon,
    snippet: r.snippet ?? "",
    score: Number(r.score),
  }));
}
