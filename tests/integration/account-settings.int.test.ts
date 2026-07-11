import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  changeOwnPassword,
  updateDisplayName,
  updateThemePreference,
} from "@/lib/auth/account";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";

/**
 * B-08 個人設定 lib 層整合測試（真 PG，N-01）：
 * 涵蓋驗收 1（變更密碼撤銷其他 session）與驗收 2（外觀偏好持久化）。
 */

const CURRENT_PW = "current-strong-pw-1";
const NEW_PW = "brand-new-strong-pw-2";

async function seedLocalUser(password: string) {
  const suffix = randomUUID().slice(0, 8);
  const [user] = await db
    .insert(users)
    .values({
      email: `acct-${suffix}@test.jetbook`,
      name: `帳號測試 ${suffix}`,
      passwordHash: await hashPassword(password),
      authProvider: "local",
    })
    .returning();
  if (!user) throw new Error("seedLocalUser failed");
  return user;
}

async function seedSession(userId: string) {
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: `sess-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning();
  if (!row) throw new Error("seedSession failed");
  return row;
}

describe("changeOwnPassword（B-08 驗收 1）", () => {
  it("驗舊密碼正確 → 覆寫 hash、撤銷本人全部 session", async () => {
    const user = await seedLocalUser(CURRENT_PW);
    await seedSession(user.id);
    await seedSession(user.id);

    const result = await changeOwnPassword(user.id, CURRENT_PW, NEW_PW);
    expect(result).toEqual({ ok: true });

    const after = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(await verifyPassword(after!.passwordHash!, NEW_PW)).toBe(true);
    expect(await verifyPassword(after!.passwordHash!, CURRENT_PW)).toBe(false);

    const remaining = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(remaining).toHaveLength(0);
  });

  it("舊密碼錯誤 → invalid_current，不動密碼與 session", async () => {
    const user = await seedLocalUser(CURRENT_PW);
    await seedSession(user.id);

    const result = await changeOwnPassword(user.id, "wrong-password", NEW_PW);
    expect(result).toEqual({ ok: false, reason: "invalid_current" });

    const after = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(await verifyPassword(after!.passwordHash!, CURRENT_PW)).toBe(true);
    const remaining = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(remaining).toHaveLength(1);
  });

  it("新密碼不符原則 → weak，不動密碼與 session", async () => {
    const user = await seedLocalUser(CURRENT_PW);
    await seedSession(user.id);

    const result = await changeOwnPassword(user.id, CURRENT_PW, "short");
    expect(result).toEqual({ ok: false, reason: "weak" });

    const remaining = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(remaining).toHaveLength(1);
  });

  it("新密碼與舊密碼相同 → same", async () => {
    const user = await seedLocalUser(CURRENT_PW);
    const result = await changeOwnPassword(user.id, CURRENT_PW, CURRENT_PW);
    expect(result).toEqual({ ok: false, reason: "same" });
  });

  it("OIDC 帳號（無本地密碼）→ not_local", async () => {
    const suffix = randomUUID().slice(0, 8);
    const [user] = await db
      .insert(users)
      .values({
        email: `oidc-${suffix}@test.jetbook`,
        name: `OIDC ${suffix}`,
        passwordHash: null,
        authProvider: "oidc",
        oidcSubject: `sub-${suffix}`,
      })
      .returning();
    const result = await changeOwnPassword(user!.id, "whatever", NEW_PW);
    expect(result).toEqual({ ok: false, reason: "not_local" });
  });
});

describe("updateDisplayName / updateThemePreference（B-08 驗收 2）", () => {
  it("更新顯示名稱", async () => {
    const user = await seedLocalUser(CURRENT_PW);
    await updateDisplayName(user.id, "新的名字");
    const after = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(after?.name).toBe("新的名字");
  });

  it("外觀偏好持久化：dark/light 存字面值、system 存 NULL", async () => {
    const user = await seedLocalUser(CURRENT_PW);

    await updateThemePreference(user.id, "dark");
    expect((await db.query.users.findFirst({ where: eq(users.id, user.id) }))?.themePreference).toBe(
      "dark",
    );

    await updateThemePreference(user.id, "light");
    expect((await db.query.users.findFirst({ where: eq(users.id, user.id) }))?.themePreference).toBe(
      "light",
    );

    await updateThemePreference(user.id, "system");
    expect(
      (await db.query.users.findFirst({ where: eq(users.id, user.id) }))?.themePreference,
    ).toBeNull();
  });
});
