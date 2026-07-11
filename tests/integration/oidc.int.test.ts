import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertOidcUser, type FederatedIdentity } from "@/lib/auth/oidc";
import { createSession, validateSessionToken } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * B-06 OIDC 使用者 upsert 與本地 session 整合測試（真 PG，N-01）：
 * 涵蓋 subject 命中、email 連結、idempotent 與 OIDC → 本地 session 換發。
 */

function makeIdentity(overrides: Partial<FederatedIdentity> = {}): FederatedIdentity {
  const suffix = randomUUID().slice(0, 8);
  return {
    subject: `oidc-sub-${suffix}`,
    email: `oidc-${suffix}@test.jetbook`,
    name: `SSO 使用者 ${suffix}`,
    ...overrides,
  };
}

describe("upsertOidcUser（真 PG）", () => {
  it("新 subject 建立 oidc 使用者（auth_provider=oidc、無密碼）", async () => {
    const identity = makeIdentity();
    const user = await upsertOidcUser(identity);

    expect(user.authProvider).toBe("oidc");
    expect(user.oidcSubject).toBe(identity.subject);
    expect(user.email).toBe(identity.email);
    expect(user.passwordHash).toBeNull();
  });

  it("同 subject 再次登入 idempotent，並同步顯示名稱", async () => {
    const identity = makeIdentity();
    const first = await upsertOidcUser(identity);
    const second = await upsertOidcUser({ ...identity, name: "更新後名稱" });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("更新後名稱");

    const rows = await db.select().from(users).where(eq(users.oidcSubject, identity.subject));
    expect(rows).toHaveLength(1);
  });

  it("既有 email 的本地帳號改由 oidc 連結（同一 user id）", async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `local-${suffix}@test.jetbook`;
    const [local] = await db
      .insert(users)
      .values({ email, name: "本地帳號", passwordHash: "hash", authProvider: "local" })
      .returning();
    if (!local) throw new Error("seed local user failed");

    const linked = await upsertOidcUser({
      subject: `oidc-sub-${suffix}`,
      email,
      name: "SSO 名稱",
    });

    expect(linked.id).toBe(local.id);
    expect(linked.authProvider).toBe("oidc");
    expect(linked.oidcSubject).toBe(`oidc-sub-${suffix}`);
  });

  it("OIDC 使用者換發本地 session 並可驗證", async () => {
    const user = await upsertOidcUser(makeIdentity());
    const { token } = await createSession(user.id, {});
    const result = await validateSessionToken(token);

    expect(result?.user.id).toBe(user.id);
    expect(result?.user.authProvider).toBe("oidc");
  });
});
