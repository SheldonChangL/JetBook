import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, spaces } from "@/lib/db/schema";
import { canReadPage, type Actor } from "@/lib/authz/permission";
import { fullTextSearch } from "@/lib/search/fulltext";
import { listAccessibleSpaces } from "@/lib/spaces/queries";

/**
 * MCP 工具實作（M4-07，F-API-04）：純 lib 層，與 MCP 佈線分離（可整合測試）。
 * 權限鐵律：全部以呼叫者（token 擁有者）為 Actor 走既有 lib/authz——
 * 無權內容絕不出現在任何工具結果；不存在與無權一律同一種回覆（防枚舉）。
 */

export interface McpSearchHit {
  pageId: string;
  title: string;
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  slug: string;
  snippet: string;
}

/** 搜尋知識庫（回純文字 snippet，去除 pgroonga 高亮標記）。 */
export async function mcpSearchPages(
  user: Actor,
  query: string,
  limit = 10,
): Promise<McpSearchHit[]> {
  const hits = await fullTextSearch(user, query, { limit: Math.min(Math.max(limit, 1), 20) });
  return hits.map((h) => ({
    pageId: h.pageId,
    title: h.title,
    spaceId: h.spaceId,
    spaceName: h.spaceName,
    spaceSlug: h.spaceSlug,
    slug: h.slug,
    snippet: h.snippet.replace(/<[^>]+>/g, ""),
  }));
}

export interface McpPage {
  id: string;
  title: string;
  spaceId: string;
  spaceName: string;
  contentMd: string;
  updatedAt: Date;
  /** 現行版本號：update_page 的 expectedVersion（樂觀鎖）以此為基準（M4-13） */
  versionNo: number;
}

/** 讀取單一頁面（Markdown）；不存在或無權回 null。 */
export async function mcpReadPage(user: Actor, pageId: string): Promise<McpPage | null> {
  const page = await db.query.pages.findFirst({ where: eq(pages.id, pageId) });
  if (!page || page.deletedAt || page.kind !== "page") return null;
  if (!(await canReadPage(user, page.id))) return null;
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  return {
    id: page.id,
    title: page.title,
    spaceId: page.spaceId,
    spaceName: space?.name ?? "",
    contentMd: page.contentMd,
    updatedAt: page.updatedAt,
    versionNo: page.currentVersionNo,
  };
}

export interface McpSpace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

/** 列出可存取空間。 */
export async function mcpListSpaces(user: Actor): Promise<McpSpace[]> {
  const rows = await listAccessibleSpaces(user);
  return rows.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
  }));
}
