import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { listRecentVisits } from "@/lib/pages/recent";
import { recordVisit } from "@/lib/pages/visits";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * F-02 Cmd+K 最近瀏覽整合測試（真 PG，N-01）。
 * /api/recent 薄殼委派 listRecentVisits；權限一律在 SQL 層 join 過濾（架構鐵律 #1/#2），
 * 涵蓋授權（可讀）與拒絕（不可讀）兩向，並驗證已刪除頁面排除。
 */
describe("listRecentVisits（最近瀏覽 · SQL 層權限過濾）", () => {
  it("org_read 空間成員可見自己的最近瀏覽", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const page = await seedPage(space.id, { title: "最近讀的頁" });
    await recordVisit(owner.id, page.id);

    const items = await listRecentVisits(owner, 5);
    expect(items.some((i) => i.pageId === page.id)).toBe(true);
  });

  it("私有空間非成員：即使留有瀏覽紀錄，仍被 SQL 層過濾", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private" });
    await addMember(priv.id, owner.id, "editor");
    const page = await seedPage(priv.id, { title: "機密頁" });

    await recordVisit(owner.id, page.id);
    await recordVisit(stranger.id, page.id);

    const ownerItems = await listRecentVisits(owner, 5);
    expect(ownerItems.some((i) => i.pageId === page.id)).toBe(true);

    const strangerItems = await listRecentVisits(stranger, 5);
    expect(strangerItems.some((i) => i.pageId === page.id)).toBe(false);
  });

  it("已刪除頁面不出現在最近瀏覽", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const page = await seedPage(space.id, { title: "待刪頁" });
    await recordVisit(owner.id, page.id);
    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, page.id));

    const items = await listRecentVisits(owner, 5);
    expect(items.some((i) => i.pageId === page.id)).toBe(false);
  });

  it("limit 生效：只回傳最近 N 筆", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    for (let i = 0; i < 7; i += 1) {
      const page = await seedPage(space.id, { title: `頁 ${i}` });
      await recordVisit(owner.id, page.id);
    }
    const items = await listRecentVisits(owner, 5);
    expect(items.length).toBe(5);
  });
});
