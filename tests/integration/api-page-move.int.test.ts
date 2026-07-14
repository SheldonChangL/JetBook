import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { attachments, auditLogs, pages } from "@/lib/db/schema";
import { createApiToken } from "@/lib/api-tokens";
import { POST as movePage } from "@/app/api/v1/pages/[id]/move/route";
import { seedPage, seedSpace, seedUser } from "./helpers";

/**
 * M4-14 API 搬移頁面整合測試（真 PG，issue #219）：
 * write scope 閘門、雙端權限（防枚舉）、同空間 reparent、循環防護、
 * 跨空間子樹搬移（space_id/附件歸屬轉移）、無效組合、稽核。
 */

async function makeToken(userId: string, scopes: ("read" | "write")[] = ["read"]) {
  const { token } = await createApiToken(userId, {
    name: `it-${randomUUID().slice(0, 8)}`,
    scopes,
    expiresAt: null,
  });
  return token;
}

function moveReq(pageId: string, token: string, body: unknown) {
  const request = new Request(`http://localhost/api/v1/pages/${pageId}/move`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return movePage(request, { params: Promise.resolve({ id: pageId }) });
}

describe("API 搬移頁面（M4-14，issue #219）", () => {
  it("read-only token → 403 INSUFFICIENT_SCOPE", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const page = await seedPage(space.id);
    const readToken = await makeToken(owner.id, ["read"]);

    const res = await moveReq(page.id, readToken, { newParentId: null });
    expect(res.status).toBe(403);
  });

  it("無來源空間權限（私有空間外人）→ 404 防枚舉", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id);
    const outsider = await seedUser();
    const token = await makeToken(outsider.id, ["read", "write"]);

    const res = await moveReq(page.id, token, { newParentId: null });
    expect(res.status).toBe(404);
  });

  it("跨空間但無目標空間權限 → 404 防枚舉，頁面未被搬移", async () => {
    const owner = await seedUser();
    const source = await seedSpace(owner.id, { visibility: "org_write" });
    const page = await seedPage(source.id);
    const other = await seedUser();
    const privateTarget = await seedSpace(other.id, { visibility: "private" });

    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);
    const res = await moveReq(page.id, token, { targetSpaceId: privateTarget.id });
    expect(res.status).toBe(404);

    const fresh = await db.query.pages.findFirst({ where: eq(pages.id, page.id) });
    expect(fresh!.spaceId).toBe(source.id);
  });

  it("同空間 reparent：掛到新父層之下；audit page.api_move 落地", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const parent = await seedPage(space.id, { title: "父頁" });
    const page = await seedPage(space.id, { title: "被搬頁" });
    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);

    const res = await moveReq(page.id, token, { newParentId: parent.id });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { parentId: string | null; movedCount: number } };
    expect(body.data.parentId).toBe(parent.id);
    expect(body.data.movedCount).toBe(1);

    const fresh = await db.query.pages.findFirst({ where: eq(pages.id, page.id) });
    expect(fresh!.parentId).toBe(parent.id);

    const audit = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.action, "page.api_move"), eq(auditLogs.targetId, page.id)),
    });
    expect(audit?.actorId).toBe(writer.id);
  });

  it("搬到自己的子孫之下 → 409 CYCLE", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const root = await seedPage(space.id, { title: "根" });
    const child = await seedPage(space.id, { title: "子", parentId: root.id });
    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);

    const res = await moveReq(root.id, token, { newParentId: child.id });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CYCLE");
  });

  it("external_link 節點不可作父 → 400 INVALID_MOVE 明確訊息（C-11）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const link = await seedPage(space.id, { kind: "external_link", externalUrl: "https://x" });
    const page = await seedPage(space.id);
    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);

    const res = await moveReq(page.id, token, { newParentId: link.id });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_MOVE");
  });

  it("跨空間搬移：子樹 space_id 與附件歸屬同交易轉移、根頁掛目標根層", async () => {
    const owner = await seedUser();
    const source = await seedSpace(owner.id, { visibility: "org_write" });
    const target = await seedSpace(owner.id, { visibility: "org_write" });
    const root = await seedPage(source.id, { title: "子樹根" });
    const child = await seedPage(source.id, { title: "子樹子頁", parentId: root.id });
    const [att] = await db
      .insert(attachments)
      .values({
        pageId: child.id,
        spaceId: source.id,
        fileName: "f.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        storageKey: `it-${randomUUID()}.pdf`,
        sha256: "x",
      })
      .returning();

    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);
    const res = await moveReq(root.id, token, { targetSpaceId: target.id });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { spaceSlug: string; parentId: string | null; movedCount: number };
    };
    expect(body.data.spaceSlug).toBe(target.slug);
    expect(body.data.parentId).toBeNull();
    expect(body.data.movedCount).toBe(2);

    const freshRoot = await db.query.pages.findFirst({ where: eq(pages.id, root.id) });
    const freshChild = await db.query.pages.findFirst({ where: eq(pages.id, child.id) });
    expect(freshRoot!.spaceId).toBe(target.id);
    expect(freshRoot!.parentId).toBeNull();
    expect(freshChild!.spaceId).toBe(target.id);
    expect(freshChild!.parentId).toBe(root.id);
    // 附件歸屬即刻跟隨目的地 space（G6）
    const freshAtt = await db.query.attachments.findFirst({
      where: eq(attachments.id, att!.id),
    });
    expect(freshAtt!.spaceId).toBe(target.id);
  });

  it("targetSpaceId＝現行空間 → 400 INVALID_MOVE", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const page = await seedPage(space.id);
    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);

    const res = await moveReq(page.id, token, { targetSpaceId: space.id });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_MOVE");
  });

  it("空 body（無 targetSpaceId 也無 newParentId）→ 400", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const page = await seedPage(space.id);
    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);

    const res = await moveReq(page.id, token, {});
    expect(res.status).toBe(400);
  });
});
