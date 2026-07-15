import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { auditLogs, spaceMembers, spaces } from "@/lib/db/schema";
import { createApiToken } from "@/lib/api-tokens";
import { apiUpdateSpace } from "@/lib/api/space-write";
import { POST as postSpaces } from "@/app/api/v1/spaces/route";
import { PATCH as patchSpace } from "@/app/api/v1/spaces/[slug]/route";
import { PUT as putMember } from "@/app/api/v1/spaces/[slug]/members/route";
import { seedUser } from "./helpers";

/**
 * M4-13 API 建立空間整合測試（真 PG，issue #218）：
 * write scope 閘門、建立者自動成為 space admin、slug 自動產生（重名加尾碼）、稽核。
 */

async function makeToken(userId: string, scopes: ("read" | "write")[] = ["read"]) {
  const { token } = await createApiToken(userId, {
    name: `it-${randomUUID().slice(0, 8)}`,
    scopes,
    expiresAt: null,
  });
  return token;
}

function jsonReq(token: string, body: unknown): Request {
  return new Request("http://localhost/api/v1/spaces", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function methodReq(method: string, url: string, token: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** route handler 的第二參數：Next 15 async params。 */
function ctx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

/** 以 REST 建一個空間並回傳 { id, slug }（呼叫者即該空間 admin）。 */
async function createSpaceViaApi(token: string, body: Record<string, unknown> = {}) {
  const res = await postSpaces(
    jsonReq(token, { name: `API 空間 ${randomUUID().slice(0, 6)}`, ...body }),
  );
  const json = (await res.json()) as {
    data: { id: string; slug: string; name: string; visibility: string };
  };
  return json.data;
}

describe("API 建立空間（M4-13，issue #218）", () => {
  it("read-only token → 403 INSUFFICIENT_SCOPE", async () => {
    const user = await seedUser();
    const readToken = await makeToken(user.id, ["read"]);

    const res = await postSpaces(jsonReq(readToken, { name: "不該建立的空間" }));
    expect(res.status).toBe(403);
  });

  it("建立成功 → 201、建立者為 space admin、audit 落地", async () => {
    const user = await seedUser();
    const token = await makeToken(user.id, ["read", "write"]);

    const name = `API 空間 ${randomUUID().slice(0, 6)}`;
    const res = await postSpaces(jsonReq(token, { name, description: "由 MCP/REST 建立" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; slug: string; name: string } };
    expect(body.data.name).toBe(name);
    expect(body.data.slug.length).toBeGreaterThan(0);

    // 建立者同交易成為該 space admin
    const membership = await db.query.spaceMembers.findFirst({
      where: and(eq(spaceMembers.spaceId, body.data.id), eq(spaceMembers.userId, user.id)),
    });
    expect(membership?.role).toBe("admin");

    // 稽核（NFR：寫入行為可追蹤）
    const audit = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.action, "space.api_create"), eq(auditLogs.targetId, body.data.id)),
    });
    expect(audit?.actorId).toBe(user.id);
  });

  it("重名空間 → slug 自動加尾碼，不回錯誤（與 web 端一致）", async () => {
    const user = await seedUser();
    const token = await makeToken(user.id, ["read", "write"]);

    const name = `重名測試 ${randomUUID().slice(0, 6)}`;
    const first = await postSpaces(jsonReq(token, { name }));
    const second = await postSpaces(jsonReq(token, { name }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const a = (await first.json()) as { data: { slug: string } };
    const b = (await second.json()) as { data: { slug: string } };
    expect(a.data.slug).not.toBe(b.data.slug);
  });

  it("name 缺漏或空字串 → 400", async () => {
    const user = await seedUser();
    const token = await makeToken(user.id, ["read", "write"]);

    expect((await postSpaces(jsonReq(token, {}))).status).toBe(400);
    expect((await postSpaces(jsonReq(token, { name: "  " }))).status).toBe(400);
  });

  it("visibility 可指定；省略＝private", async () => {
    const user = await seedUser();
    const token = await makeToken(user.id, ["read", "write"]);

    const withVis = await createSpaceViaApi(token, { visibility: "org_read" });
    expect(withVis.visibility).toBe("org_read");

    const defaulted = await createSpaceViaApi(token);
    expect(defaulted.visibility).toBe("private");
  });
});

describe("API 更新空間（PATCH /spaces/{slug}）", () => {
  it("管理員可改 name／visibility；空 body → 400", async () => {
    const user = await seedUser();
    const token = await makeToken(user.id, ["read", "write"]);
    const space = await createSpaceViaApi(token);

    const empty = await patchSpace(
      methodReq("PATCH", `http://localhost/api/v1/spaces/${space.slug}`, token, {}),
      ctx(space.slug),
    );
    expect(empty.status).toBe(400);

    const res = await patchSpace(
      methodReq("PATCH", `http://localhost/api/v1/spaces/${space.slug}`, token, {
        name: "改名後空間",
        visibility: "org_write",
      }),
      ctx(space.slug),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string; visibility: string } };
    expect(body.data.name).toBe("改名後空間");
    expect(body.data.visibility).toBe("org_write");
  });

  it("部分更新：未提供欄位（undefined，模擬 MCP 只給 name）不被清空", async () => {
    const user = await seedUser();
    const token = await makeToken(user.id, ["read", "write"]);
    const space = await createSpaceViaApi(token, {
      description: "原始描述",
      visibility: "org_read",
    });

    // MCP handler 會把未提供的欄位以 undefined 傳入——這些欄位必須保留原值
    const outcome = await apiUpdateSpace(user, {
      spaceId: space.id,
      name: "只改名稱",
      description: undefined,
      icon: undefined,
      visibility: undefined,
    });
    expect(outcome.ok).toBe(true);

    const row = await db.query.spaces.findFirst({ where: eq(spaces.id, space.id) });
    expect(row?.name).toBe("只改名稱");
    expect(row?.visibility).toBe("org_read"); // 未提供 → 保留（非清成 NULL / 報錯）
    expect(row?.description).toBe("原始描述"); // 未提供 → 保留
  });

  it("非管理員 → 404（防枚舉，即使可讀）", async () => {
    const owner = await seedUser();
    const ownerToken = await makeToken(owner.id, ["read", "write"]);
    const space = await createSpaceViaApi(ownerToken, { visibility: "org_read" });

    const outsider = await seedUser();
    const outsiderToken = await makeToken(outsider.id, ["read", "write"]);
    const res = await patchSpace(
      methodReq("PATCH", `http://localhost/api/v1/spaces/${space.slug}`, outsiderToken, {
        name: "越權改名",
      }),
      ctx(space.slug),
    );
    expect(res.status).toBe(404);
  });
});

describe("API 空間成員（PUT /spaces/{slug}/members）", () => {
  it("以 email 加入成員 → 200 並落地；role=none 移除", async () => {
    const owner = await seedUser();
    const token = await makeToken(owner.id, ["read", "write"]);
    const space = await createSpaceViaApi(token);
    const member = await seedUser();

    const add = await putMember(
      methodReq("PUT", `http://localhost/api/v1/spaces/${space.slug}/members`, token, {
        email: member.email,
        role: "editor",
      }),
      ctx(space.slug),
    );
    expect(add.status).toBe(200);
    const row = await db.query.spaceMembers.findFirst({
      where: and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, member.id)),
    });
    expect(row?.role).toBe("editor");

    const remove = await putMember(
      methodReq("PUT", `http://localhost/api/v1/spaces/${space.slug}/members`, token, {
        email: member.email,
        role: "none",
      }),
      ctx(space.slug),
    );
    expect(remove.status).toBe(200);
    const gone = await db.query.spaceMembers.findFirst({
      where: and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, member.id)),
    });
    expect(gone).toBeUndefined();
  });

  it("查無 email → 404 USER_NOT_FOUND", async () => {
    const owner = await seedUser();
    const token = await makeToken(owner.id, ["read", "write"]);
    const space = await createSpaceViaApi(token);

    const res = await putMember(
      methodReq("PUT", `http://localhost/api/v1/spaces/${space.slug}/members`, token, {
        email: `nobody-${randomUUID()}@example.com`,
        role: "viewer",
      }),
      ctx(space.slug),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("USER_NOT_FOUND");
  });

  it("移除最後一位 admin → 409 LAST_ADMIN", async () => {
    const owner = await seedUser();
    const token = await makeToken(owner.id, ["read", "write"]);
    const space = await createSpaceViaApi(token);

    const res = await putMember(
      methodReq("PUT", `http://localhost/api/v1/spaces/${space.slug}/members`, token, {
        email: owner.email,
        role: "none",
      }),
      ctx(space.slug),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("LAST_ADMIN");
  });

  it("非管理員 → 404（防枚舉）", async () => {
    const owner = await seedUser();
    const ownerToken = await makeToken(owner.id, ["read", "write"]);
    const space = await createSpaceViaApi(ownerToken, { visibility: "org_read" });

    const outsider = await seedUser();
    const outsiderToken = await makeToken(outsider.id, ["read", "write"]);
    const target = await seedUser();
    const res = await putMember(
      methodReq("PUT", `http://localhost/api/v1/spaces/${space.slug}/members`, outsiderToken, {
        email: target.email,
        role: "viewer",
      }),
      ctx(space.slug),
    );
    expect(res.status).toBe(404);
  });
});
