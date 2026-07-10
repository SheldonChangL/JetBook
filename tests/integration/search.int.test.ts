import { describe, expect, it } from "vitest";
import { fullTextSearch } from "@/lib/search/fulltext";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * F-01 全文搜尋整合測試（真 PG + pgroonga，N-01）：
 * 中文分詞命中與 SQL 層權限過濾（F-SEARCH-01 驗收）。
 */

describe("fullTextSearch（pgroonga 中文分詞）", () => {
  it("「捷揚」子字串命中「捷揚光電」；標題加權高於內文", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    await seedPage(space.id, {
      title: "捷揚光電員工手冊",
      contentText: "本手冊說明出勤與福利規定。",
    });
    await seedPage(space.id, {
      title: "無關標題",
      contentText: "內文提到捷揚的產品線。",
    });

    const hits = await fullTextSearch(owner, "捷揚");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // 標題命中者分數較高排前
    expect(hits[0]?.title).toBe("捷揚光電員工手冊");
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it("命中片段帶 <mark> 高亮或摘要", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    await seedPage(space.id, {
      title: "校準流程",
      contentText: "雷射校準前必須預熱三十分鐘並記錄功率。",
    });
    const hits = await fullTextSearch(owner, "預熱");
    expect(hits[0]?.snippet.length).toBeGreaterThan(0);
  });

  it("權限過濾：非成員搜不到 private space 的內容", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private" });
    await addMember(priv.id, owner.id, "editor");
    await seedPage(priv.id, {
      title: "機密光學配方",
      contentText: "鍍膜配方與參數屬營業秘密。",
    });

    const ownerHits = await fullTextSearch(owner, "鍍膜配方");
    expect(ownerHits.some((h) => h.title === "機密光學配方")).toBe(true);

    const strangerHits = await fullTextSearch(stranger, "鍍膜配方");
    expect(strangerHits.some((h) => h.title === "機密光學配方")).toBe(false);
  });

  it("空查詢回空結果", async () => {
    const owner = await seedUser();
    expect(await fullTextSearch(owner, "  ")).toEqual([]);
  });
});
