import { describe, expect, it } from "vitest";
import { canReadPage, getAccessiblePageIds } from "@/lib/authz/permission";
import { getSpaceRole } from "@/lib/authz/spaces";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * B-03 授權核心整合測試（真 PG，N-01）：
 * SQL 層權限過濾是 N-04 RAG 隔離的基礎，必須以真資料庫驗證。
 */

describe("getSpaceRole（角色解析）", () => {
  it("成員角色 > visibility 隱含角色 > 拒絕", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private" });
    await addMember(priv.id, owner.id, "admin");

    expect(await getSpaceRole(owner, priv.id)).toBe("admin");
    expect(await getSpaceRole(stranger, priv.id)).toBeNull();

    const orgRead = await seedSpace(owner.id, { visibility: "org_read" });
    expect(await getSpaceRole(stranger, orgRead.id)).toBe("viewer");

    const orgWrite = await seedSpace(owner.id, { visibility: "org_write" });
    expect(await getSpaceRole(stranger, orgWrite.id)).toBe("editor");
  });

  it("org admin 對任何 space 都是 admin", async () => {
    const owner = await seedUser();
    const orgAdmin = await seedUser({ orgRole: "admin" });
    const priv = await seedSpace(owner.id, { visibility: "private" });
    expect(await getSpaceRole(orgAdmin, priv.id)).toBe("admin");
  });

  it("commenter 為第四級角色（C3）", async () => {
    const owner = await seedUser();
    const commenter = await seedUser();
    const space = await seedSpace(owner.id);
    await addMember(space.id, commenter.id, "commenter");
    expect(await getSpaceRole(commenter, space.id)).toBe("commenter");
  });
});

describe("getAccessiblePageIds（SQL 層過濾——N-04 基礎）", () => {
  it("private space 頁面對非成員完全不可見", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private" });
    await addMember(priv.id, owner.id, "editor");
    const page = await seedPage(priv.id);

    expect(await getAccessiblePageIds(owner)).toContain(page.id);
    expect(await getAccessiblePageIds(stranger)).not.toContain(page.id);
    expect(await canReadPage(stranger, page.id)).toBe(false);
  });

  it("requireAiIndexing 排除關閉 AI 索引的 space（NFR-COMP-03）", async () => {
    const owner = await seedUser();
    const noAi = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: false });
    const withAi = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });
    const pageNoAi = await seedPage(noAi.id);
    const pageWithAi = await seedPage(withAi.id);

    const ragIds = await getAccessiblePageIds(owner, undefined, { requireAiIndexing: true });
    expect(ragIds).toContain(pageWithAi.id);
    expect(ragIds).not.toContain(pageNoAi.id);

    // 一般讀取（非 RAG）不受 AI 旗標影響
    const readIds = await getAccessiblePageIds(owner);
    expect(readIds).toContain(pageNoAi.id);
  });

  it("軟刪除頁面與封存 space 均排除", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const page = await seedPage(space.id);

    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, page.id));
    expect(await getAccessiblePageIds(owner)).not.toContain(page.id);
  });

  it("spaceId 參數限定單一 space", async () => {
    const owner = await seedUser();
    const a = await seedSpace(owner.id, { visibility: "org_read" });
    const b = await seedSpace(owner.id, { visibility: "org_read" });
    const pageA = await seedPage(a.id);
    const pageB = await seedPage(b.id);

    const ids = await getAccessiblePageIds(owner, a.id);
    expect(ids).toContain(pageA.id);
    expect(ids).not.toContain(pageB.id);
  });
});
