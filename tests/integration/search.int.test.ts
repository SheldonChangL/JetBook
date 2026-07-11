import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fullTextSearch } from "@/lib/search/fulltext";
import { listSearchAuthors } from "@/lib/search/filters";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * F-01 全文搜尋整合測試（真 PG + pgroonga，N-01）：
 * 中文分詞命中與 SQL 層權限過濾（F-SEARCH-01 驗收）。
 */

/** 每測試唯一的搜尋標記詞：pgroonga 以整個 ASCII token 為單一詞，隨機值避免跨測試互相污染。 */
function uniqueToken() {
  return "zfilter" + randomUUID().replace(/-/g, "").slice(0, 12);
}

/** 相對於現在的 N 天前時間點（更新時間過濾用）。 */
function daysAgo(n: number) {
  return new Date(Date.now() - n * 86_400_000);
}

const titlesOf = (hits: { title: string }[]) => hits.map((h) => h.title).sort();

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

/**
 * F-03 搜尋過濾器整合測試（F-SEARCH-03）：
 * Space／作者／更新時間可單獨與組合套用；權限過濾（getAccessiblePageIds）不受過濾器影響。
 */
describe("fullTextSearch 過濾器（Space / 作者 / 更新時間，可組合）", () => {
  it("三種過濾器單獨與組合皆生效", async () => {
    const token = uniqueToken();
    const reader = await seedUser();
    const authorA = await seedUser({ name: "過濾作者A" });
    const authorB = await seedUser({ name: "過濾作者B" });
    const spaceX = await seedSpace(reader.id, { visibility: "org_read" });
    const spaceY = await seedSpace(reader.id, { visibility: "org_read" });

    // spaceX：近(1天/A)、久(45天/A)、中(15天/B)；spaceY：近(1天/A)
    await seedPage(spaceX.id, {
      title: "最近A",
      contentText: `${token} 內容`,
      createdBy: authorA.id,
      updatedAt: daysAgo(1),
    });
    await seedPage(spaceX.id, {
      title: "久遠A",
      contentText: `${token} 內容`,
      createdBy: authorA.id,
      updatedAt: daysAgo(45),
    });
    await seedPage(spaceX.id, {
      title: "中間B",
      contentText: `${token} 內容`,
      createdBy: authorB.id,
      updatedAt: daysAgo(15),
    });
    await seedPage(spaceY.id, {
      title: "另空間A",
      contentText: `${token} 內容`,
      createdBy: authorA.id,
      updatedAt: daysAgo(1),
    });

    // 無過濾：四頁全中
    expect(titlesOf(await fullTextSearch(reader, token))).toEqual(
      ["中間B", "久遠A", "另空間A", "最近A"].sort(),
    );

    // Space 過濾：只留 spaceX
    expect(titlesOf(await fullTextSearch(reader, token, { spaceId: spaceX.id }))).toEqual(
      ["中間B", "久遠A", "最近A"].sort(),
    );

    // 作者過濾：只留 A（跨 space）
    expect(titlesOf(await fullTextSearch(reader, token, { authorId: authorA.id }))).toEqual(
      ["久遠A", "另空間A", "最近A"].sort(),
    );

    // 更新時間 30 天：排除久遠A（45 天）
    expect(titlesOf(await fullTextSearch(reader, token, { updatedWithinDays: 30 }))).toEqual(
      ["中間B", "另空間A", "最近A"].sort(),
    );

    // 更新時間 7 天：只留 1 天內
    expect(titlesOf(await fullTextSearch(reader, token, { updatedWithinDays: 7 }))).toEqual(
      ["另空間A", "最近A"].sort(),
    );

    // 組合：Space=X ∧ 作者=A ∧ 30 天 → 只剩最近A
    expect(
      titlesOf(
        await fullTextSearch(reader, token, {
          spaceId: spaceX.id,
          authorId: authorA.id,
          updatedWithinDays: 30,
        }),
      ),
    ).toEqual(["最近A"]);
  });

  it("權限過濾優先於過濾器：無權者套用相符過濾也搜不到 private 內容", async () => {
    const token = uniqueToken();
    const owner = await seedUser();
    const stranger = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private" });
    await addMember(priv.id, owner.id, "editor");
    await seedPage(priv.id, {
      title: "機密過濾頁",
      contentText: `${token} 機密`,
      createdBy: owner.id,
      updatedAt: daysAgo(1),
    });

    const filters = { authorId: owner.id, updatedWithinDays: 7 };
    // owner（成員）套用過濾仍看得到
    expect((await fullTextSearch(owner, token, filters)).some((h) => h.title === "機密過濾頁")).toBe(
      true,
    );
    // stranger 套用相同過濾（作者存在、時間相符）仍看不到——權限先於過濾器
    expect(
      (await fullTextSearch(stranger, token, filters)).some((h) => h.title === "機密過濾頁"),
    ).toBe(false);
  });

  it("listSearchAuthors 只列出可讀頁面的作者", async () => {
    const reader = await seedUser();
    const publicAuthor = await seedUser({ name: `公開作者-${randomUUID().slice(0, 6)}` });
    const secretAuthor = await seedUser({ name: `機密作者-${randomUUID().slice(0, 6)}` });

    const pub = await seedSpace(reader.id, { visibility: "org_read" });
    await seedPage(pub.id, { createdBy: publicAuthor.id });

    const priv = await seedSpace(secretAuthor.id, { visibility: "private" });
    await addMember(priv.id, secretAuthor.id, "editor");
    await seedPage(priv.id, { createdBy: secretAuthor.id });

    const authorIds = (await listSearchAuthors(reader)).map((a) => a.id);
    expect(authorIds).toContain(publicAuthor.id);
    expect(authorIds).not.toContain(secretAuthor.id);
  });
});
