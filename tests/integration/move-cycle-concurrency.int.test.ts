import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { movePageNode } from "@/lib/pages/move";
import { PageMoveCycleError } from "@/lib/pages/errors";
import { seedPage, seedSpace, seedUser } from "./helpers";

/**
 * 並發 reparent 循環防護整合測試（真 PG，issue #224）：
 * READ COMMITTED 下並行 reparent 若無序列化，會各自通過 cycle check 後成環——
 * 兩節點互掛（X→Y ∥ Y→X），或多節點環（A→B ∥ C→D 於 B→C、D→A 預接鏈上，鎖集合不相交，
 * 故 per-row 列鎖不完備）。movePageNode 交易開頭以每空間 advisory lock 序列化同空間全部
 * reparent，衝突方擲 PageMoveCycleError（或 NOT_FOUND），事後 parent 鏈必無環。
 */

/** 從 pageId 沿 parent 鏈上行，maxSteps 步內必達根（parent=null），否則視為成環回傳 false。 */
async function reachesRoot(pageId: string, maxSteps = 16): Promise<boolean> {
  let current: string | null = pageId;
  for (let i = 0; i < maxSteps; i++) {
    const row: { parentId: string | null } | undefined = await db.query.pages.findFirst({
      where: eq(pages.id, current!),
      columns: { parentId: true },
    });
    if (!row) return false;
    if (row.parentId === null) return true;
    current = row.parentId;
  }
  return false;
}

function assertExpectedOutcome(results: PromiseSettledResult<unknown>[]) {
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  // 至多一方可成功；兩方都成功＝成環。
  expect(fulfilled.length).toBeLessThanOrEqual(1);
  // 失敗方必為循環防護（或極端交錯下的 NOT_FOUND），不得是其他非預期例外。
  for (const r of results) {
    if (r.status !== "rejected") continue;
    const err = r.reason;
    const ok =
      err instanceof PageMoveCycleError || (err instanceof Error && err.message === "NOT_FOUND");
    expect(ok, `非預期例外：${String(err)}`).toBe(true);
  }
}

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
      assertExpectedOutcome(results);

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

  it("多節點環（鎖集合不相交）：預接 B→C、D→A，並行 A→B 與 C→D 不得成 4 節點環", async () => {
    // 反例場景：per-row 列鎖會失效——T1(A→B) 鎖 {A,B}、T2(C→D) 鎖 {C,D} 不相交、互不阻塞，
    // 各自 cycle check（A 子樹={A,D} 無 B；C 子樹={C,B} 無 D）都通過，提交後 A→B→C→D→A 成環。
    // per-space advisory lock 序列化後：後行者重讀已提交狀態，cycle check 必偵測到環。
    for (let round = 0; round < 8; round++) {
      const owner = await seedUser();
      const space = await seedSpace(owner.id, { visibility: "org_write" });
      const a = await seedPage(space.id, { title: `A-${round}` });
      const c = await seedPage(space.id, { title: `C-${round}` });
      const b = await seedPage(space.id, { title: `B-${round}`, parentId: c.id });
      const d = await seedPage(space.id, { title: `D-${round}`, parentId: a.id });

      const results = await Promise.allSettled([
        movePageNode({ pageId: a.id, newParentId: b.id, movedBy: owner.id }),
        movePageNode({ pageId: c.id, newParentId: d.id, movedBy: owner.id }),
      ]);
      assertExpectedOutcome(results);

      // 結構驗證：從每個節點沿 parent 鏈上行，有限步內必達根，否則成環。
      for (const node of [a, b, c, d]) {
        expect(await reachesRoot(node.id), `節點 ${node.title} 的 parent 鏈成環`).toBe(true);
      }
    }
  });
});
