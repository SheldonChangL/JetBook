import { describe, expect, it } from "vitest";
import { createApiToken, listApiTokens, revokeApiToken, verifyApiToken } from "@/lib/api-tokens";
import { setUserActive } from "@/lib/admin/users";
import { seedUser } from "./helpers";

/** M4-06 API Token 生命週期整合測試（真 PG）。 */

describe("API Token 生命週期（M4-06，issue #197）", () => {
  it("建立後可驗證；明文含 jbk_ 前綴且僅回傳一次（DB 只有 hash）", async () => {
    const user = await seedUser();
    const { token, row } = await createApiToken(user.id, {
      name: "整合測試",
      scopes: ["read"],
      expiresAt: null,
    });
    expect(token.startsWith("jbk_")).toBe(true);
    expect(row.scopes).toEqual(["read"]);

    const verified = await verifyApiToken(token);
    expect(verified?.user.id).toBe(user.id);
    expect(verified?.scopes).toEqual(["read"]);
  });

  it("撤銷後立即驗證失敗；列表不含已撤銷", async () => {
    const user = await seedUser();
    const { token, row } = await createApiToken(user.id, {
      name: "待撤銷",
      scopes: ["read"],
      expiresAt: null,
    });
    expect(await revokeApiToken(user.id, row.id)).toBe(true);
    expect(await verifyApiToken(token)).toBeNull();
    expect((await listApiTokens(user.id)).find((t) => t.id === row.id)).toBeUndefined();
  });

  it("他人無法撤銷我的 token", async () => {
    const owner = await seedUser();
    const attacker = await seedUser();
    const { token, row } = await createApiToken(owner.id, {
      name: "不可被他人撤銷",
      scopes: ["read"],
      expiresAt: null,
    });
    expect(await revokeApiToken(attacker.id, row.id)).toBe(false);
    expect(await verifyApiToken(token)).not.toBeNull();
  });

  it("過期 token 驗證失敗", async () => {
    const user = await seedUser();
    const { token } = await createApiToken(user.id, {
      name: "已過期",
      scopes: ["read"],
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await verifyApiToken(token)).toBeNull();
  });

  it("擁有者被停用後 token 立即失效", async () => {
    const user = await seedUser();
    const { token } = await createApiToken(user.id, {
      name: "停用者",
      scopes: ["read"],
      expiresAt: null,
    });
    await setUserActive(user.id, false);
    expect(await verifyApiToken(token)).toBeNull();
  });

  it("偽造字串驗證失敗", async () => {
    expect(await verifyApiToken("jbk_not-a-real-token")).toBeNull();
    expect(await verifyApiToken("random")).toBeNull();
  });
});
