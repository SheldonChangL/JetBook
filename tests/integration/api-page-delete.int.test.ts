import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { auditLogs, pages } from "@/lib/db/schema";
import { createApiToken } from "@/lib/api-tokens";
import { fullTextSearch } from "@/lib/search/fulltext";
import { listTrashItems, restoreTrashPage } from "@/lib/pages/trash";
import { DELETE as deletePage } from "@/app/api/v1/pages/[id]/route";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * M4-15 API 軟刪除頁面整合測試（真 PG，issue #220）：
 * write scope 閘門、防枚舉、HAS_CHILDREN 拒絕、recursive 子樹同批軟刪、
 * 回收桶可還原、軟刪即退出搜尋、稽核。
 */

async function makeToken(userId: string, scopes: ("read" | "write")[] = ["read"]) {
  const { token } = await createApiToken(userId, {
    name: `it-${randomUUID().slice(0, 8)}`,
    scopes,
    expiresAt: null,
  });
  return token;
}

function delReq(pageId: string, token: string, recursive?: boolean) {
  const qs = recursive ? "?recursive=true" : "";
  const request = new Request(`http://localhost/api/v1/pages/${pageId}${qs}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  return deletePage(request, { params: Promise.resolve({ id: pageId }) });
}

describe("API 軟刪除頁面（M4-15，issue #220）", () => {
  it("read-only token → 403；無權（私有空間外人）→ 404 防枚舉", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id);

    const readToken = await makeToken(owner.id, ["read"]);
    expect((await delReq(page.id, readToken)).status).toBe(403);

    const outsider = await seedUser();
    const outsiderToken = await makeToken(outsider.id, ["read", "write"]);
    expect((await delReq(page.id, outsiderToken)).status).toBe(404);

    const fresh = await db.query.pages.findFirst({ where: eq(pages.id, page.id) });
    expect(fresh!.deletedAt).toBeNull();
  });

  it("有子頁且未帶 recursive → 409 HAS_CHILDREN 含 childCount，整支未刪", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const root = await seedPage(space.id, { title: "有子頁的根" });
    await seedPage(space.id, { parentId: root.id });
    await seedPage(space.id, { parentId: root.id });
    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);

    const res = await delReq(root.id, token);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; childCount: number } };
    expect(body.error.code).toBe("HAS_CHILDREN");
    expect(body.error.childCount).toBe(2);

    const fresh = await db.query.pages.findFirst({ where: eq(pages.id, root.id) });
    expect(fresh!.deletedAt).toBeNull();
  });

  it("葉節點不帶 recursive → 成功軟刪；audit page.delete via=api 落地", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const page = await seedPage(space.id);
    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);

    const res = await delReq(page.id, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deletedPageIds: string[] } };
    expect(body.data.deletedPageIds).toEqual([page.id]);

    const fresh = await db.query.pages.findFirst({ where: eq(pages.id, page.id) });
    expect(fresh!.deletedAt).not.toBeNull();

    const audit = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.action, "page.delete"), eq(auditLogs.targetId, page.id)),
    });
    expect(audit?.actorId).toBe(writer.id);
    expect((audit?.metadata as { via?: string })?.via).toBe("api");
  });

  it("recursive=true → 子樹同批軟刪，回收桶列頂節點且可整批還原", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const root = await seedPage(space.id, { title: "刪除子樹根" });
    const child = await seedPage(space.id, { parentId: root.id });
    const grandchild = await seedPage(space.id, { parentId: child.id });
    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);

    const res = await delReq(root.id, token, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deletedPageIds: string[] } };
    expect(body.data.deletedPageIds).toHaveLength(3);

    // 同批 deleted_at（一「批」）：回收桶只列頂節點、descendantCount=2
    const items = await listTrashItems([space.id]);
    const item = items.find((i) => i.pageId === root.id);
    expect(item).toBeDefined();
    expect(item!.descendantCount).toBe(2);
    expect(items.find((i) => i.pageId === child.id)).toBeUndefined();

    // 還原整批
    await restoreTrashPage({ pageId: root.id, userId: owner.id });
    for (const id of [root.id, child.id, grandchild.id]) {
      const fresh = await db.query.pages.findFirst({ where: eq(pages.id, id) });
      expect(fresh!.deletedAt).toBeNull();
    }
  });

  it("軟刪內容即刻退出全文搜尋（N-04 隔離模式）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const marker = `刪除隔離${randomUUID().slice(0, 6)}`;
    const page = await seedPage(space.id, { title: `${marker} 目標頁`, contentText: marker });
    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);

    const before = await fullTextSearch(writer, marker);
    expect(before.some((h) => h.pageId === page.id)).toBe(true);

    // org_read 空間對一般成員唯讀 → 刪除應被拒（權限預設拒絕）；改用 org_write 成員語意驗刪除
    // 此處 writer 對 org_read 無編輯權 → 404
    expect((await delReq(page.id, token)).status).toBe(404);

    // editor 成員刪除成功後退出搜尋（org_read 空間需明確成員身分才有編輯權）
    await addMember(space.id, owner.id, "admin");
    const ownerToken = await makeToken(owner.id, ["read", "write"]);
    expect((await delReq(page.id, ownerToken)).status).toBe(200);
    const after = await fullTextSearch(owner, marker);
    expect(after.some((h) => h.pageId === page.id)).toBe(false);
  });
});
