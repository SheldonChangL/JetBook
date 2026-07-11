import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  validatePasswordResetToken,
} from "@/lib/auth/password-reset";
import { verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { passwordResetTokens, sessions, users } from "@/lib/db/schema";
import { seedUser } from "./helpers";

/**
 * B-05 忘記密碼重設 token 整合測試（真 PG，N-01）：
 * 涵蓋驗收——連結單次有效有時限、重設後撤銷全部 session。
 */

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

const STRONG_PASSWORD = "brand-new-strong-pw";

describe("password reset token（B-05）", () => {
  it("建立可驗證；消費後單次失效、密碼更新、全部 session 撤銷", async () => {
    const user = await seedUser();
    await seedSession(user.id);
    await seedSession(user.id);

    const { token } = await createPasswordResetToken(user.id);
    expect(await validatePasswordResetToken(token)).toEqual({ userId: user.id });

    const result = await consumePasswordResetToken(token, STRONG_PASSWORD);
    expect(result).toEqual({ ok: true, userId: user.id });

    // 密碼已更新且可驗證
    const after = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(after?.passwordHash).toBeTruthy();
    expect(await verifyPassword(after!.passwordHash!, STRONG_PASSWORD)).toBe(true);

    // 全部 session 撤銷
    const remaining = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(remaining).toHaveLength(0);

    // 單次使用：同 token 再次消費 → invalid，且驗證也失效
    expect(await consumePasswordResetToken(token, "another-strong-pw")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await validatePasswordResetToken(token)).toBeNull();
  });

  it("過期 token 無法驗證或消費（有時限）", async () => {
    const user = await seedUser();
    const { token } = await createPasswordResetToken(user.id);
    await db
      .update(passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResetTokens.userId, user.id));

    expect(await validatePasswordResetToken(token)).toBeNull();
    expect(await consumePasswordResetToken(token, STRONG_PASSWORD)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("弱密碼被拒且不消費 token", async () => {
    const user = await seedUser();
    const { token } = await createPasswordResetToken(user.id);
    expect(await consumePasswordResetToken(token, "short")).toEqual({
      ok: false,
      reason: "weak",
    });
    // token 仍可用
    expect(await validatePasswordResetToken(token)).toEqual({ userId: user.id });
  });

  it("重新申請會作廢先前未使用的 token（一次僅一個有效連結）", async () => {
    const user = await seedUser();
    const { token: first } = await createPasswordResetToken(user.id);
    const { token: second } = await createPasswordResetToken(user.id);
    expect(await validatePasswordResetToken(first)).toBeNull();
    expect(await validatePasswordResetToken(second)).toEqual({ userId: user.id });
  });

  it("不存在的 token → invalid", async () => {
    expect(await validatePasswordResetToken("nonexistent-token")).toBeNull();
    expect(await consumePasswordResetToken("nonexistent-token", STRONG_PASSWORD)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
