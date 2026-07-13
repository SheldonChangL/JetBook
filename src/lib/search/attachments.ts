import "server-only";
import { and, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, pages, spaces } from "@/lib/db/schema";
import { getAccessiblePageIds, type Actor } from "@/lib/authz/permission";

/**
 * 附件檔名搜尋（M4-04，issue #195）。
 * 權限鐵律同 fulltext：先取可讀 pageId 集合（getAccessiblePageIds，SQL 層過濾），
 * 附件經所屬頁面繼承權限——無頁面歸屬（pageId null，如 GC 寬限中的孤兒）不入結果。
 */

export interface AttachmentHit {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  spaceSlug: string;
  spaceName: string;
  createdAt: Date;
}

/** 使用者輸入進 LIKE pattern 前跳脫萬用字元（同 lib/admin/users 作法）。 */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function searchAttachmentsByName(
  user: Actor,
  query: string,
  options: { limit?: number } = {},
): Promise<AttachmentHit[]> {
  const q = query.trim();
  if (!q) return [];

  const accessibleIds = await getAccessiblePageIds(user);
  if (accessibleIds.length === 0) return [];

  const limit = Math.min(options.limit ?? 20, 50);
  const pattern = `%${escapeLikePattern(q)}%`;

  const rows = await db
    .select({
      id: attachments.id,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      pageId: pages.id,
      pageTitle: pages.title,
      pageSlug: pages.slug,
      spaceSlug: spaces.slug,
      spaceName: spaces.name,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .innerJoin(pages, eq(pages.id, attachments.pageId))
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .where(
      and(
        ilike(attachments.fileName, pattern),
        inArray(attachments.pageId, accessibleIds),
        isNull(pages.deletedAt),
      ),
    )
    .orderBy(desc(attachments.createdAt))
    .limit(limit);

  return rows;
}
