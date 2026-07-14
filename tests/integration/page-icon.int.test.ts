import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { fullTextSearch } from "@/lib/search/fulltext";
import { seedPage, seedSpace, seedUser } from "./helpers";

/** M4-03：icon 欄位隨全文搜尋回傳（Cmd+K/搜尋頁顯示用）；權限過濾不受影響。 */

describe("頁面 icon 於搜尋結果（M4-03，issue #194）", () => {
  it("fullTextSearch 回傳頁面 icon；未設定為 null", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const marker = `圖示測試${randomUUID().slice(0, 6)}`;
    const withIcon = await seedPage(space.id, { title: `${marker} 有圖示` });
    await db.update(pages).set({ icon: "🚀" }).where(eq(pages.id, withIcon.id));
    const without = await seedPage(space.id, { title: `${marker} 無圖示` });

    const reader = await seedUser();
    const hits = await fullTextSearch(reader, marker);
    const hitWith = hits.find((h) => h.pageId === withIcon.id);
    const hitWithout = hits.find((h) => h.pageId === without.id);
    expect(hitWith?.icon).toBe("🚀");
    expect(hitWithout?.icon).toBeNull();
  });

  it("無權限頁面（私有空間）即使有 icon 也不出現在結果", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const marker = `私有圖示${randomUUID().slice(0, 6)}`;
    const secret = await seedPage(space.id, { title: `${marker} 機密` });
    await db.update(pages).set({ icon: "🔒" }).where(eq(pages.id, secret.id));

    const outsider = await seedUser();
    const hits = await fullTextSearch(outsider, marker);
    expect(hits.find((h) => h.pageId === secret.id)).toBeUndefined();
  });
});
