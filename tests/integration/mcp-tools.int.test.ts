import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { mcpListSpaces, mcpReadPage, mcpSearchPages } from "@/lib/mcp/tools";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * M4-07 MCP 工具整合測試（真 PG）：工具結果權限完全受呼叫者約束（N-04 精神延伸）。
 */

describe("MCP 工具（M4-07，issue #198）", () => {
  it("search_pages：命中可讀內容、剝除高亮標記；無權內容絕不出現", async () => {
    const owner = await seedUser();
    const marker = `MCP搜尋${randomUUID().slice(0, 6)}`;
    const openSpace = await seedSpace(owner.id, { visibility: "org_read" });
    const openPage = await seedPage(openSpace.id, {
      title: `${marker} 公開頁`,
      contentText: `${marker} 內文`,
    });
    const secretSpace = await seedSpace(owner.id, { visibility: "private" });
    await seedPage(secretSpace.id, { title: `${marker} 機密頁` });

    const caller = await seedUser();
    const hits = await mcpSearchPages(caller, marker);
    expect(hits.map((h) => h.pageId)).toEqual([openPage.id]);
    expect(hits[0]?.snippet).not.toMatch(/<[^>]+>/);
  });

  it("read_page：可讀者取得 Markdown；無權/不存在一律 null", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id, { title: "MCP 讀取頁" });

    const member = await seedUser();
    await addMember(space.id, member.id, "viewer");
    const ok = await mcpReadPage(member, page.id);
    expect(ok?.title).toBe("MCP 讀取頁");

    const outsider = await seedUser();
    expect(await mcpReadPage(outsider, page.id)).toBeNull();
    expect(await mcpReadPage(outsider, randomUUID())).toBeNull();
  });

  it("list_spaces：只含可存取空間", async () => {
    const owner = await seedUser();
    const privateSpace = await seedSpace(owner.id, { visibility: "private" });
    const openSpace = await seedSpace(owner.id, { visibility: "org_read" });

    const caller = await seedUser();
    const rows = await mcpListSpaces(caller);
    const ids = rows.map((s) => s.id);
    expect(ids).toContain(openSpace.id);
    expect(ids).not.toContain(privateSpace.id);
  });
});
