"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { consumePasswordResetToken, createPasswordResetToken } from "@/lib/auth/password-reset";
import { deleteSessionCookie } from "@/lib/auth/session";
import { sendEmail } from "@/lib/email";
import { passwordResetRateLimiter } from "@/lib/rate-limit";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { requestLogger } from "@/lib/logger";
import { env } from "@/lib/env";

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export type ForgotState = { status: "idle" } | { status: "sent" };

/**
 * 忘記密碼：一律回傳相同「已寄出」訊息（不論帳號是否存在／是否合格），防帳號枚舉。
 * 僅對「啟用中的本地帳號」實際寄出重設連結（OIDC 帳號無密碼可重設）。
 */
export async function requestPasswordReset(
  _prev: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const requestHeaders = await headers();
  const log = requestLogger(new Headers(requestHeaders));
  const ip = ipFromHeaders(requestHeaders) ?? "unknown";

  // IP 層 rate limit：防濫發信件轟炸；達到上限時靜默略過，仍回相同訊息不洩漏
  const rate = passwordResetRateLimiter.check(`forgot:${ip}`);
  const parsed = requestSchema.safeParse({ email: formData.get("email") });

  if (rate.allowed && parsed.success) {
    const { email } = parsed.data;
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (user && user.isActive && user.authProvider === "local" && user.passwordHash) {
      const { token } = await createPasswordResetToken(user.id);
      const resetUrl = `${env.BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
      const t = await getTranslations("email");
      await sendEmail({
        to: user.email,
        subject: t("resetSubject"),
        text: t("resetBody", { name: user.name, url: resetUrl }),
      });
      await writeAudit({
        actorId: user.id,
        action: "auth.password_reset_requested",
        targetType: "user",
        targetId: user.id,
        ip,
      });
      log.info({ userId: user.id, ip }, "password reset requested");
    } else {
      log.info({ ip }, "password reset requested for unknown/ineligible account");
    }
  }

  return { status: "sent" };
}

const resetSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(1),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "mismatch",
  });

export type ResetState =
  | { status: "idle" }
  | { status: "error"; code: "invalid" | "weak" | "mismatch" };

/**
 * 重設密碼：消費 token（單次）→ 更新密碼 → 撤銷全部 session（lib 交易內）→ 清當前 cookie → 導向登入。
 * 清當前裝置 cookie 是為避免 stale-cookie 在登入頁造成導向迴圈（session 已於 lib 全數撤銷）。
 */
export async function resetPassword(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some((i) => i.message === "mismatch");
    return { status: "error", code: mismatch ? "mismatch" : "invalid" };
  }

  const result = await consumePasswordResetToken(parsed.data.token, parsed.data.password);
  if (!result.ok) {
    return { status: "error", code: result.reason };
  }

  const requestHeaders = await headers();
  await writeAudit({
    actorId: result.userId,
    action: "auth.password_reset",
    targetType: "user",
    targetId: result.userId,
    ip: ipFromHeaders(requestHeaders),
  });
  requestLogger(new Headers(requestHeaders)).info(
    { userId: result.userId },
    "password reset completed",
  );

  await deleteSessionCookie();
  redirect("/login?reset=success");
}
