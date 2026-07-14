import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pages, pageVersions, spaces } from "@/lib/db/schema";
import { createApiToken } from "@/lib/api-tokens";
import { acquireLock } from "@/lib/pages/lock";
import { apiUpdatePage } from "@/lib/api/page-write";
import { POST as postSpacePage } from "@/app/api/v1/spaces/[slug]/pages/route";
import { PATCH as patchPage } from "@/app/api/v1/pages/[id]/route";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * M4-09 API 寫入整合測試（真 PG，issue #211）：
 * write scope 閘門、權限拒絕（授權/拒絕兩向）、三欄同交易一致、
 * 版本快照、軟性編輯鎖拒絕、封存空間唯讀。
 */

async function makeToken(userId: string, scopes: ("read" | "write")[] = ["read"]) {
  const { token } = await createApiToken(userId, {
    name: `it-${randomUUID().slice(0, 8)}`,
    scopes,
    expiresAt: null,
  });
  return token;
}

function jsonReq(path: string, token: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API 寫入（M4-09，issue #211）", () => {
  it("read-only token 呼叫寫入端點 → 403 INSUFFICIENT_SCOPE", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const page = await seedPage(space.id);
    const readToken = await makeToken(owner.id, ["read"]);

    const createRes = await postSpacePage(
      jsonReq(`/api/v1/spaces/${space.slug}/pages`, readToken, "POST", {
        title: "x",
        markdown: "x",
      }),
      { params: Promise.resolve({ slug: space.slug }) },
    );
    expect(createRes.status).toBe(403);

    const patchRes = await patchPage(
      jsonReq(`/api/v1/pages/${page.id}`, readToken, "PATCH", { markdown: "x" }),
      { params: Promise.resolve({ id: page.id }) },
    );
    expect(patchRes.status).toBe(403);
  });

  it("write token 但無 page.edit 權限（私有空間外人）→ 404 不洩漏存在性", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id);
    const outsider = await seedUser();
    const token = await makeToken(outsider.id, ["read", "write"]);

    const createRes = await postSpacePage(
      jsonReq(`/api/v1/spaces/${space.slug}/pages`, token, "POST", { title: "x", markdown: "x" }),
      { params: Promise.resolve({ slug: space.slug }) },
    );
    expect(createRes.status).toBe(404);

    const patchRes = await patchPage(
      jsonReq(`/api/v1/pages/${page.id}`, token, "PATCH", { markdown: "x" }),
      { params: Promise.resolve({ id: page.id }) },
    );
    expect(patchRes.status).toBe(404);
  });

  it("POST 建頁：三欄同交易一致＋版本快照＋回傳 201", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const editor = await seedUser();
    await addMember(space.id, editor.id, "editor");
    const token = await makeToken(editor.id, ["read", "write"]);

    const marker = `寫入測試${randomUUID().slice(0, 6)}`;
    const res = await postSpacePage(
      jsonReq(`/api/v1/spaces/${space.slug}/pages`, token, "POST", {
        title: "API 建立的頁面",
        markdown: `# 標題\n\n${marker} 內文段落。`,
      }),
      { params: Promise.resolve({ slug: space.slug }) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; versionNo: number } };
    expect(body.data.versionNo).toBe(1);

    const page = await db.query.pages.findFirst({ where: eq(pages.id, body.data.id) });
    expect(page).toBeDefined();
    expect(page!.title).toBe("API 建立的頁面");
    // 三欄同交易同步（架構鐵律 #5）：content_md 與 content_text 皆由 canonical JSON 衍生
    expect(page!.contentMd).toContain(marker);
    expect(page!.contentText).toContain(marker);
    expect(page!.content).not.toBeNull();
    // 版本快照（E-01）
    const versions = await db.query.pageVersions.findMany({
      where: eq(pageVersions.pageId, page!.id),
    });
    expect(versions.length).toBe(1);
    expect(versions[0]!.createdBy).toBe(editor.id);
  });

  it("PATCH 更新：版本遞增、三欄同步、寫後鎖已釋放", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const page = await seedPage(space.id, { title: "待更新頁" });
    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);

    const marker = `更新內容${randomUUID().slice(0, 6)}`;
    const res = await patchPage(
      jsonReq(`/api/v1/pages/${page.id}`, token, "PATCH", { markdown: `${marker} 新內文。` }),
      { params: Promise.resolve({ id: page.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { versionNo: number } };
    expect(body.data.versionNo).toBe(page.currentVersionNo + 1);

    const fresh = await db.query.pages.findFirst({ where: eq(pages.id, page.id) });
    expect(fresh!.contentMd).toContain(marker);
    expect(fresh!.contentText).toContain(marker);
    // 寫入期間短暫取鎖，完成後必須釋放（不干擾他人後續編輯）
    expect(fresh!.lockedBy).toBeNull();
  });

  it("他人持有效編輯鎖 → PATCH 409 LOCKED，內容未被改動（C1）", async () => {
    const owner = await seedUser({ name: "鎖定持有者" });
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const page = await seedPage(space.id, { contentText: "原內容" });
    expect(await acquireLock(page.id, owner.id)).toBe(true);

    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);
    const res = await patchPage(
      jsonReq(`/api/v1/pages/${page.id}`, token, "PATCH", { markdown: "企圖覆寫" }),
      { params: Promise.resolve({ id: page.id }) },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("LOCKED");

    const fresh = await db.query.pages.findFirst({ where: eq(pages.id, page.id) });
    expect(fresh!.contentMd).not.toContain("企圖覆寫");
    // 鎖仍屬原持有者
    expect(fresh!.lockedBy).toBe(owner.id);
  });

  it("本人已持鎖（編輯器開啟中）→ API 寫入成功且不釋放本人的鎖", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const page = await seedPage(space.id);
    const writer = await seedUser();
    expect(await acquireLock(page.id, writer.id)).toBe(true);

    const result = await apiUpdatePage(
      { id: writer.id, orgRole: "member" },
      { pageId: page.id, markdown: "本人寫入" },
    );
    expect(result.ok).toBe(true);
    const fresh = await db.query.pages.findFirst({ where: eq(pages.id, page.id) });
    expect(fresh!.lockedBy).toBe(writer.id);
  });

  it("封存空間唯讀（F-ORG-04）：write token 亦不得寫入", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const page = await seedPage(space.id);
    await db.update(spaces).set({ archivedAt: new Date() }).where(eq(spaces.id, space.id));

    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);

    const createRes = await postSpacePage(
      jsonReq(`/api/v1/spaces/${space.slug}/pages`, token, "POST", { title: "x", markdown: "x" }),
      { params: Promise.resolve({ slug: space.slug }) },
    );
    expect(createRes.status).toBe(404);

    const patchRes = await patchPage(
      jsonReq(`/api/v1/pages/${page.id}`, token, "PATCH", { markdown: "x" }),
      { params: Promise.resolve({ id: page.id }) },
    );
    expect(patchRes.status).toBe(404);
  });

  it("parentId 屬其他空間 → 404（不得跨空間掛節點）", async () => {
    const owner = await seedUser();
    const spaceA = await seedSpace(owner.id, { visibility: "org_write" });
    const spaceB = await seedSpace(owner.id, { visibility: "org_write" });
    const foreignParent = await seedPage(spaceB.id);

    const writer = await seedUser();
    const token = await makeToken(writer.id, ["read", "write"]);
    const res = await postSpacePage(
      jsonReq(`/api/v1/spaces/${spaceA.slug}/pages`, token, "POST", {
        title: "x",
        markdown: "x",
        parentId: foreignParent.id,
      }),
      { params: Promise.resolve({ slug: spaceA.slug }) },
    );
    expect(res.status).toBe(404);
  });
});
