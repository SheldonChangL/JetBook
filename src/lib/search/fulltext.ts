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
  /** 命中內文片段（HTML，已 pgroonga 高亮 <mark>） */
  snippet: string;
  score: number;
}

/**
 * 全文搜尋（F-SEARCH-01，ADR-007 pgroonga）。
 * 權限：先取可讀 pageId 集合（SQL 層過濾），再以 pgroonga `&@~` 查詢 + 分數排序。
 * 標題命中權重高於內文；回傳含 <mark> 高亮片段。
 */
export async function fullTextSearch(
  user: Actor,
  query: string,
  options: { spaceId?: string; limit?: number } = {},
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  const accessibleIds = await getAccessiblePageIds(user, options.spaceId);
  if (accessibleIds.length === 0) return [];

  const limit = Math.min(options.limit ?? 20, 50);

  // pgroonga_score 以 title 命中加權 3 倍、content 命中 1 倍合併；
  // pgroonga_snippet_html 產生高亮片段。權限以 id in (...) 於 SQL 層限定。
  const rows = await db.execute<{
    page_id: string;
    space_slug: string;
    space_name: string;
    slug: string;
    title: string;
    snippet: string;
    score: number;
  }>(sql`
    SELECT
      p.id AS page_id,
      s.slug AS space_slug,
      s.name AS space_name,
      p.slug AS slug,
      p.title AS title,
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
    ORDER BY score DESC, p.updated_at DESC
    LIMIT ${limit}
  `);

  return rows.rows.map((r) => ({
    pageId: r.page_id,
    spaceSlug: r.space_slug,
    spaceName: r.space_name,
    slug: r.slug,
    title: r.title,
    snippet: r.snippet ?? "",
    score: Number(r.score),
  }));
}
