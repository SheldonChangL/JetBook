import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { auditLogs, spaceMembers } from "@/lib/db/schema";
import { createApiToken } from "@/lib/api-tokens";
import { POST as postSpaces } from "@/app/api/v1/spaces/route";
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
});
