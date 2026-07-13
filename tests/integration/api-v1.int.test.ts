import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { createApiToken, revokeApiToken } from "@/lib/api-tokens";
import { GET as getSpaces } from "@/app/api/v1/spaces/route";
import { GET as getSpacePages } from "@/app/api/v1/spaces/[slug]/pages/route";
import { GET as getPage } from "@/app/api/v1/pages/[id]/route";
import { GET as getSearch } from "@/app/api/v1/search/route";
import { GET as getOpenApi } from "@/app/api/v1/openapi.json/route";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * M4-06 REST API v1 整合測試（真 PG，直接呼叫 route handler）：
 * Bearer 認證、撤銷即失效、權限與 UI 一致（授權/拒絕兩向）。
 */

async function makeToken(userId: string): Promise<string> {
  const { token } = await createApiToken(userId, {
    name: `it-${randomUUID().slice(0, 8)}`,
    scopes: ["read"],
    expiresAt: null,
  });
  return token;
}

function req(path: string, token?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("REST API v1（M4-06，issue #197）", () => {
  it("無/壞 token → 401；撤銷後立即 401", async () => {
    expect((await getSpaces(req("/api/v1/spaces"))).status).toBe(401);
    expect((await getSpaces(req("/api/v1/spaces", "jbk_bogus"))).status).toBe(401);

    const user = await seedUser();
    const { token, row } = await createApiToken(user.id, {
      name: "撤銷測試",
      scopes: ["read"],
      expiresAt: null,
    });
    expect((await getSpaces(req("/api/v1/spaces", token))).status).toBe(200);
    await revokeApiToken(user.id, row.id);
    expect((await getSpaces(req("/api/v1/spaces", token))).status).toBe(401);
  });

  it("GET /spaces：只回可存取空間（私有空間對外人不可見）", async () => {
    const owner = await seedUser();
    const privateSpace = await seedSpace(owner.id, { visibility: "private" });
    const openSpace = await seedSpace(owner.id, { visibility: "org_read" });

    const outsider = await seedUser();
    const token = await makeToken(outsider.id);
    const res = await getSpaces(req("/api/v1/spaces", token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    const ids = body.data.map((s) => s.id);
    expect(ids).toContain(openSpace.id);
    expect(ids).not.toContain(privateSpace.id);
  });

  it("GET /spaces/{slug}/pages：可讀成員取得節點；外人 404", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id, { title: "API 樹節點" });
    const member = await seedUser();
    await addMember(space.id, member.id, "viewer");

    const memberRes = await getSpacePages(req(`/api/v1/spaces/${space.slug}/pages`, await makeToken(member.id)), {
      params: Promise.resolve({ slug: space.slug }),
    });
    expect(memberRes.status).toBe(200);
    const body = (await memberRes.json()) as { data: { id: string }[] };
    expect(body.data.map((n) => n.id)).toContain(page.id);

    const outsiderRes = await getSpacePages(
      req(`/api/v1/spaces/${space.slug}/pages`, await makeToken((await seedUser()).id)),
      { params: Promise.resolve({ slug: space.slug }) },
    );
    expect(outsiderRes.status).toBe(404);
  });

  it("GET /pages/{id}：可讀者取得 contentMd；無權者 404（不洩漏存在性）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const page = await seedPage(space.id, { title: "API 讀取頁", contentText: "內文" });

    const reader = await seedUser();
    const okRes = await getPage(req(`/api/v1/pages/${page.id}`, await makeToken(reader.id)), {
      params: Promise.resolve({ id: page.id }),
    });
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as { data: { title: string; spaceSlug: string } };
    expect(body.data.title).toBe("API 讀取頁");
    expect(body.data.spaceSlug).toBe(space.slug);

    // 私有空間頁面對外人 404
    const secretSpace = await seedSpace(owner.id, { visibility: "private" });
    const secretPage = await seedPage(secretSpace.id);
    const denied = await getPage(
      req(`/api/v1/pages/${secretPage.id}`, await makeToken(reader.id)),
      { params: Promise.resolve({ id: secretPage.id }) },
    );
    expect(denied.status).toBe(404);
  });

  it("GET /search：結果不含無權內容；缺 q 400", async () => {
    const owner = await seedUser();
    const marker = `API搜尋${randomUUID().slice(0, 6)}`;
    const openSpace = await seedSpace(owner.id, { visibility: "org_read" });
    const openPage = await seedPage(openSpace.id, { title: `${marker} 公開` });
    const secretSpace = await seedSpace(owner.id, { visibility: "private" });
    await seedPage(secretSpace.id, { title: `${marker} 機密` });

    const token = await makeToken((await seedUser()).id);
    const res = await getSearch(req(`/api/v1/search?q=${encodeURIComponent(marker)}`, token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { pageId: string }[] };
    expect(body.data.map((h) => h.pageId)).toEqual([openPage.id]);

    expect((await getSearch(req("/api/v1/search", token))).status).toBe(400);
  });

  it("GET /openapi.json：有效 OpenAPI（無需認證）", async () => {
    const res = getOpenApi();
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toContain("/api/v1/search");
  });
});
