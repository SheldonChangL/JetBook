import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { passwordResetTokens, sessions, users } from "@/lib/db/schema";
import { hashPassword, isPasswordAcceptable } from "@/lib/auth/password";

/**
 * 忘記密碼重設 token（B-05）：
 * - 32-byte 隨機 token，DB 只存 sha256(token)（外洩面最小化，與 session 同策略）
 * - 有效期 30 分鐘、單次使用（used_at 記號 + 交易內原子認領，防競態重放）
 * - 消費成功後於同交易撤銷該使用者全部 session（驗收：重設後撤銷全部 session）
 */
const TOKEN_TTL_MS = 30 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * 產生重設 token，回傳原始 token（僅寄給使用者，不落 DB）。
 * 先作廢該使用者既有未使用 token：一次僅允許一個有效連結（重新申請即讓舊連結失效）。
 */
export async function createPasswordResetToken(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db.transaction(async (tx) => {
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
    await tx.insert(passwordResetTokens).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
    });
  });
  return { token, expiresAt };
}

/** 驗證 token 是否可用（存在、未使用、未過期）；回傳 userId。不消費。 */
export async function validatePasswordResetToken(
  token: string,
): Promise<{ userId: string } | null> {
  const row = await db.query.passwordResetTokens.findFirst({
    where: and(
      eq(passwordResetTokens.tokenHash, hashToken(token)),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, new Date()),
    ),
  });
  return row ? { userId: row.userId } : null;
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "weak" };

/**
 * 消費 token 並重設密碼：交易內原子認領 token（單次使用），更新密碼雜湊，
 * 撤銷該使用者全部 session（含當前裝置外的所有登入）。
 * token 無效／過期／已用 → invalid；新密碼不符原則 → weak（token 不消費）。
 */
export async function consumePasswordResetToken(
  token: string,
  newPassword: string,
): Promise<ConsumeResult> {
  if (!isPasswordAcceptable(newPassword)) {
    return { ok: false, reason: "weak" };
  }
  // argon2 雜湊耗時，先在交易外算好，縮短交易持鎖時間
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  return db.transaction(async (tx): Promise<ConsumeResult> => {
    // 原子認領：只有仍未使用且未過期的 token 能被標記，兩個並發請求只有一個成功（單次使用）
    const claimed = await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now),
        ),
      )
      .returning({ userId: passwordResetTokens.userId });

    const userId = claimed[0]?.userId;
    if (!userId) {
      return { ok: false, reason: "invalid" };
    }

    await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, userId));
    // 撤銷全部 session（同交易，確保與密碼變更原子一致）
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    return { ok: true, userId };
  });
}
