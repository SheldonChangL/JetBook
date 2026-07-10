import "server-only";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { PageMoveCycleError } from "./errors";
import { positionBetween } from "./position";

export interface MovePageNodeInput {
  pageId: string;
  /** 新父節點；null＝移到根層 */
  newParentId: string | null;
  /** 插在此兄弟節點之前（與 afterId 擇一；都省略＝接在末尾） */
  beforeId?: string | null;
  /** 插在此兄弟節點之後 */
  afterId?: string | null;
  /** 操作者（寫入 updated_by） */
  movedBy: string;
}

/**
 * 頁面搬移／排序（C-04，ADR-001 fractional index）：
 * - 只改動被搬移節點本身的 parent_id/position，兄弟節點零重排；
 * - 循環防護：同一交易內以 recursive CTE 確認 newParent 不在 pageId 子樹（含自身），
 *   違反即丟 PageMoveCycleError；
 * - beforeId/afterId 指定目標父節點下的錨點兄弟，positionBetween 取鄰位中間鍵。
 * 呼叫端（server action）負責 session／authz（lib/authz 唯一入口）。
 */
export async function movePageNode(input: MovePageNodeInput): Promise<{ position: string }> {
  const { pageId, newParentId, beforeId = null, afterId = null, movedBy } = input;
  if (newParentId === pageId) throw new PageMoveCycleError();

  return db.transaction(async (tx) => {
    const page = await tx.query.pages.findFirst({ where: eq(pages.id, pageId) });
    if (!page || page.deletedAt) throw new Error("NOT_FOUND");

    if (newParentId !== null) {
      const parent = await tx.query.pages.findFirst({ where: eq(pages.id, newParentId) });
      if (!parent || parent.deletedAt || parent.spaceId !== page.spaceId) {
        throw new Error("NOT_FOUND");
      }
      // 循環防護：newParent 不得位於 pageId 的子樹內
      const cycle = await tx.execute<{ id: string }>(sql`
        WITH RECURSIVE subtree AS (
          SELECT id FROM ${pages} WHERE id = ${pageId}
          UNION ALL
          SELECT p.id FROM ${pages} p JOIN subtree s ON p.parent_id = s.id
        )
        SELECT id FROM subtree WHERE id = ${newParentId} LIMIT 1
      `);
      if (cycle.rows.length > 0) throw new PageMoveCycleError();
    }

    // 目標父節點下的兄弟（排除自身、未刪除），依 position 排序
    const siblings = await tx
      .select({ id: pages.id, position: pages.position })
      .from(pages)
      .where(
        and(
          eq(pages.spaceId, page.spaceId),
          newParentId === null ? isNull(pages.parentId) : eq(pages.parentId, newParentId),
          isNull(pages.deletedAt),
          ne(pages.id, pageId),
        ),
      )
      // fractional index 是 base-62 位元組序鍵：必須 COLLATE "C"（DB 預設 en_US 會把 "I" 排在 "a0" 後）
      .orderBy(asc(sql`${pages.position} COLLATE "C"`));

    let lo: string | null;
    let hi: string | null;
    if (beforeId) {
      const idx = siblings.findIndex((s) => s.id === beforeId);
      if (idx < 0) throw new Error("NOT_FOUND");
      lo = siblings[idx - 1]?.position ?? null;
      hi = siblings[idx]!.position;
    } else if (afterId) {
      const idx = siblings.findIndex((s) => s.id === afterId);
      if (idx < 0) throw new Error("NOT_FOUND");
      lo = siblings[idx]!.position;
      hi = siblings[idx + 1]?.position ?? null;
    } else {
      lo = siblings[siblings.length - 1]?.position ?? null;
      hi = null;
    }
    const position = positionBetween(lo, hi);

    await tx
      .update(pages)
      .set({ parentId: newParentId, position, updatedBy: movedBy, updatedAt: new Date() })
      .where(eq(pages.id, pageId));
    return { position };
  });
}
