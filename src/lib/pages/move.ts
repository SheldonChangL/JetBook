import "server-only";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
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
  /**
   * 呼叫端權限檢查時頁面所屬的 space（M4-14 API 路徑）：交易內重讀後不符即 NOT_FOUND，
   * 堵住「權限檢查後、交易前」頁面被並發搬到他空間的 TOCTOU 窗口。省略＝不驗（web 互動路徑）。
   */
  expectedSpaceId?: string;
}

/**
 * 頁面搬移／排序（C-04，ADR-001 fractional index）：
 * - 只改動被搬移節點本身的 parent_id/position，兄弟節點零重排；
 * - 循環防護：交易開頭先以固定順序（id 排序）`SELECT ... FOR UPDATE` 鎖定被搬頁與新父頁列，
 *   序列化互相衝突的 reparent（防止並行「X→Y」「Y→X」各自通過 cycle check 後成環，issue #224），
 *   再於同一交易內以 recursive CTE 確認 newParent 不在 pageId 子樹（含自身），違反即丟 PageMoveCycleError；
 * - beforeId/afterId 指定目標父節點下的錨點兄弟，positionBetween 取鄰位中間鍵。
 * 呼叫端（server action）負責 session／authz（lib/authz 唯一入口）。
 */
export async function movePageNode(input: MovePageNodeInput): Promise<{ position: string }> {
  const { pageId, newParentId, beforeId = null, afterId = null, movedBy } = input;
  if (newParentId === pageId) throw new PageMoveCycleError();

  return db.transaction(async (tx) => {
    // 循環防護第一道（issue #224）：先以固定順序（id 排序）取被搬頁與新父頁的列鎖，序列化互相
    // 衝突的並行 reparent。READ COMMITTED 下無此鎖時，並行「X→Y」與「Y→X」會各自讀到對方舊
    // parent_id、都通過下方 cycle check、更新不同列不互相阻塞，提交後成環。固定 id 排序取鎖避免死鎖；
    // 後取鎖者被阻塞、待前者提交後重讀最新已提交狀態，其 cycle check 即能偵測到環並 rollback。
    const idsToLock = Array.from(
      new Set(newParentId === null ? [pageId] : [pageId, newParentId]),
    );
    await tx
      .select({ id: pages.id })
      .from(pages)
      .where(inArray(pages.id, idsToLock))
      .orderBy(asc(pages.id))
      .for("update");

    const page = await tx.query.pages.findFirst({ where: eq(pages.id, pageId) });
    if (!page || page.deletedAt) throw new Error("NOT_FOUND");
    if (input.expectedSpaceId && page.spaceId !== input.expectedSpaceId) {
      throw new Error("NOT_FOUND");
    }

    if (newParentId !== null) {
      const parent = await tx.query.pages.findFirst({ where: eq(pages.id, newParentId) });
      if (!parent || parent.deletedAt || parent.spaceId !== page.spaceId) {
        throw new Error("NOT_FOUND");
      }
      // 外部連結為葉節點，不得作為父（C-11）。
      if (parent.kind === "external_link") throw new Error("EXTERNAL_LINK_NO_CHILDREN");
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
