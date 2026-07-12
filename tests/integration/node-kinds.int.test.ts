import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { getAccessiblePageIds } from "@/lib/authz/permission";
import { fullTextSearch } from "@/lib/search/fulltext";
import { createPageInTx } from "@/lib/pages/create";
import { copyPageSubtreeToSpace } from "@/lib/pages/cross-space";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * C-11 群組節點與外部連結節點整合測試（F-PAGE-04，真 PG）。
 * 重點：pages.kind 三型別建立與保存；external_link 葉節點約束；
 * getAccessiblePageIds／全文搜尋僅檢索一般內容頁（群組／外部節點不進 RAG/搜尋，關乎 N-04）；
 * 跨 Space 複製保留節點型別與目標 URL。
 */

/** 每測試唯一 ASCII 標記詞（pgroonga 以整個 token 為一詞，避免跨測試污染）。 */
function uniqueToken() {
  return "znode" + randomUUID().replace(/-/g, "").slice(0, 12);
}

describe("C-11 節點型別（group / external_link）", () => {
  it("createPageInTx 建立 group／external_link 並保存 kind 與 external_url", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });

    const group = await db.transaction((tx) =>
      createPageInTx(tx, { spaceId: space.id, parentId: null, title: "分節標題", userId: owner.id, kind: "group" }),
    );
    const ext = await db.transaction((tx) =>
      createPageInTx(tx, {
        spaceId: space.id,
        parentId: null,
        title: "外部文件",
        userId: owner.id,
        kind: "external_link",
        externalUrl: "https://example.com/docs",
      }),
    );

    expect(group.kind).toBe("group");
    expect(group.externalUrl).toBeNull();
    expect(ext.kind).toBe("external_link");
    expect(ext.externalUrl).toBe("https://example.com/docs");
  });

  it("external_link 為葉節點：不得作為任何節點的父", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const ext = await db.transaction((tx) =>
      createPageInTx(tx, {
        spaceId: space.id,
        parentId: null,
        title: "葉外部節點",
        userId: owner.id,
        kind: "external_link",
        externalUrl: "https://example.com",
      }),
    );

    await expect(
      db.transaction((tx) =>
        createPageInTx(tx, { spaceId: space.id, parentId: ext.id, title: "非法子頁", userId: owner.id }),
      ),
    ).rejects.toThrow("EXTERNAL_LINK_NO_CHILDREN");
  });

  it("getAccessiblePageIds 僅回一般內容頁：排除 group／external（N-04）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, owner.id, "editor");

    const page = await seedPage(space.id, { title: "內容頁" });
    const group = await seedPage(space.id, { title: "群組節點", kind: "group" });
    const ext = await seedPage(space.id, {
      title: "外部節點",
      kind: "external_link",
      externalUrl: "https://example.com",
    });

    const ids = await getAccessiblePageIds(owner, space.id);
    expect(ids).toContain(page.id);
    expect(ids).not.toContain(group.id);
    expect(ids).not.toContain(ext.id);
  });

  it("全文搜尋不回傳 group／external（即使標題命中）", async () => {
    const token = uniqueToken();
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });

    await seedPage(space.id, { title: `內容頁 ${token}`, contentText: "一般內文" });
    await seedPage(space.id, { title: `群組 ${token}`, kind: "group" });
    await seedPage(space.id, {
      title: `外部 ${token}`,
      kind: "external_link",
      externalUrl: "https://example.com",
    });

    const hits = await fullTextSearch(owner, token);
    const titles = hits.map((h) => h.title);
    expect(titles).toContain(`內容頁 ${token}`);
    expect(titles.some((tt) => tt.startsWith("群組"))).toBe(false);
    expect(titles.some((tt) => tt.startsWith("外部"))).toBe(false);
  });

  it("跨 Space 複製保留節點型別與外部 URL", async () => {
    const owner = await seedUser({ orgRole: "admin" });
    const source = await seedSpace(owner.id, { visibility: "org_write" });
    const target = await seedSpace(owner.id, { visibility: "org_write" });

    // 群組（根）下掛一般頁與外部連結各一。
    const group = await db.transaction((tx) =>
      createPageInTx(tx, { spaceId: source.id, parentId: null, title: "手冊分節", userId: owner.id, kind: "group" }),
    );
    await db.transaction((tx) =>
      createPageInTx(tx, { spaceId: source.id, parentId: group.id, title: "章節一", userId: owner.id }),
    );
    await db.transaction((tx) =>
      createPageInTx(tx, {
        spaceId: source.id,
        parentId: group.id,
        title: "官方網站",
        userId: owner.id,
        kind: "external_link",
        externalUrl: "https://jet-opto.example/site",
      }),
    );

    const { copiedPageIds } = await copyPageSubtreeToSpace({
      pageId: group.id,
      targetSpaceId: target.id,
      userId: owner.id,
    });
    expect(copiedPageIds.length).toBe(3);

    const copied = await db.query.pages.findMany({
      where: eq(pages.spaceId, target.id),
    });
    const byKind = (k: string) => copied.filter((c) => c.kind === k);
    expect(byKind("group").map((c) => c.title)).toEqual(["手冊分節"]);
    expect(byKind("page").map((c) => c.title)).toEqual(["章節一"]);
    const extCopy = byKind("external_link");
    expect(extCopy.map((c) => c.title)).toEqual(["官方網站"]);
    expect(extCopy[0]?.externalUrl).toBe("https://jet-opto.example/site");
  });
});
