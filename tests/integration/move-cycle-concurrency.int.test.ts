import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { movePageNode } from "@/lib/pages/move";
import { PageMoveCycleError } from "@/lib/pages/errors";
import { seedPage, seedSpace, seedUser } from "./helpers";

/**
 * 並發 reparent 循環防護整合測試（真 PG，issue #224）：
 * READ COMMITTED 下並行「X 掛到 Y」與「Y 掛到 X」若無列鎖，會各自通過 cycle check 後成環。
 * movePageNode 交易開頭以固定 id 排序取列鎖序列化衝突的 reparent，故恰一方成功、另一方
 * 擲 PageMoveCycleError（或 NOT_FOUND），事後兩頁不得互為父子成環。
 */

/** 以 recursive CTE 從 rootId 出發走子樹，回傳能觸及的節點數；成環時 UNION ALL 會去重收斂，
 *  但兩頁互為父子時彼此都在對方子樹 → 兩支子樹都會涵蓋雙方，可據此斷言未成環。 */
async function subtreeIds(rootId: string): Promise<string[]> {
  const res = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id, parent_id FROM ${pages} WHERE id = ${rootId}
      UNION ALL
      SELECT p.id, p.parent_id FROM ${pages} p JOIN subtree s ON p.parent_id = s.id
    )
    SELECT id FROM subtree
  `);
  return res.rows.map((r) => r.id);
}

describe("並發互掛循環防護（issue #224）", () => {
  it("並行 X→Y 與 Y→X：恰一方成功，另一方擲循環錯誤，事後無環", async () => {
    // flake 保險：重複數輪，任一輪成環即失敗。
    for (let round = 0; round < 8; round++) {
      const owner = await seedUser();
      const space = await seedSpace(owner.id, { visibility: "org_write" });
      const x = await seedPage(space.id, { title: `X-${round}` });
      const y = await seedPage(space.id, { title: `Y-${round}` });

      const results = await Promise.allSettled([
        movePageNode({ pageId: x.id, newParentId: y.id, movedBy: owner.id }),
        movePageNode({ pageId: y.id, newParentId: x.id, movedBy: owner.id }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // 至多一方可成功；成環才會兩方都成功。
      expect(fulfilled.length).toBeLessThanOrEqual(1);
      // 失敗方必為循環防護（或極端交錯下的 NOT_FOUND），不得是其他非預期例外。
      for (const r of rejected) {
        const err = (r as PromiseRejectedResult).reason;
        const ok =
          err instanceof PageMoveCycleError ||
          (err instanceof Error && err.message === "NOT_FOUND");
        expect(ok, `非預期例外：${String(err)}`).toBe(true);
      }

      // 結構驗證：X、Y 不得互為父子。
      const freshX = await db.query.pages.findFirst({ where: eq(pages.id, x.id) });
      const freshY = await db.query.pages.findFirst({ where: eq(pages.id, y.id) });
      const xUnderY = freshX!.parentId === y.id;
      const yUnderX = freshY!.parentId === x.id;
      expect(xUnderY && yUnderX, "X↔Y 互為父子成環").toBe(false);

      // 子樹遍歷驗證：從任一根走 recursive CTE，另一根不得同時把自己也涵蓋回來成閉環。
      const fromX = await subtreeIds(x.id);
      const fromY = await subtreeIds(y.id);
      const cyclic = fromX.includes(y.id) && fromY.includes(x.id);
      expect(cyclic, "recursive CTE 偵測到 X↔Y 環").toBe(false);
    }
  });
});
