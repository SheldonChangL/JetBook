"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";
import {
  changeOwnPassword,
  THEME_PREFERENCES,
  updateDisplayName,
  updateThemePreference,
} from "@/lib/auth/account";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { requestLogger } from "@/lib/logger";

/**
 * 個人設定 server action 薄殼（B-08）：驗 session → zod 驗證 → 呼叫 lib 層。
 * 商業規則以 result union 回傳供 UI 呈現；未預期錯誤照常拋出。
 */

export type ProfileResult = { ok: true } | { ok: false; error: "invalid" };

const profileSchema = z.object({ name: z.string().trim().min(1).max(100) });

export async function updateProfileAction(input: { name: string }): Promise<ProfileResult> {
  const { user } = await requireSession();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  await updateDisplayName(user.id, parsed.data.name);
  revalidatePath("/settings");
  return { ok: true };
}

export type AppearanceResult = { ok: true } | { ok: false; error: "invalid" };

const appearanceSchema = z.object({ theme: z.enum(THEME_PREFERENCES) });

export async function updateAppearanceAction(input: {
  theme: string;
}): Promise<AppearanceResult> {
  const { user } = await requireSession();
  const parsed = appearanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  await updateThemePreference(user.id, parsed.data.theme);
  revalidatePath("/settings");
  return { ok: true };
}

export type PasswordFailureReason =
  | "invalid"
  | "mismatch"
  | "invalid_current"
  | "weak"
  | "same"
  | "not_local";

export type PasswordResult = { ok: true } | { ok: false; reason: PasswordFailureReason };

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(1),
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"] });

export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<PasswordResult> {
  const { user } = await requireSession();
  const requestHeaders = await headers();
  const log = requestLogger(new Headers(requestHeaders));

  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) {
    // 唯一的欄位級 refine 是 confirmPassword 不符；其餘缺漏歸 invalid
    const mismatch = parsed.error.issues.some((i) => i.path[0] === "confirmPassword");
    return { ok: false, reason: mismatch ? "mismatch" : "invalid" };
  }
  const { currentPassword, newPassword } = parsed.data;

  const result = await changeOwnPassword(user.id, currentPassword, newPassword);
  if (!result.ok) {
    if (result.reason === "not_found") return { ok: false, reason: "invalid" };
    return { ok: false, reason: result.reason };
  }

  // changeOwnPassword 已撤銷本人全部 session（含當前）；為當前裝置重建 session 與 cookie，
  // 使本人維持登入、其他裝置立即失效。以持久 cookie 重建（絕對逾時），避免關閉瀏覽器被登出。
  const { token, session } = await createSession(user.id, {
    ip: ipFromHeaders(requestHeaders),
    userAgent: requestHeaders.get("user-agent"),
  });
  await setSessionCookie(token, session.expiresAt);

  const ip = ipFromHeaders(requestHeaders) ?? "unknown";
  log.info({ userId: user.id, ip }, "password changed");
  await writeAudit({
    actorId: user.id,
    action: "auth.password_change",
    targetType: "user",
    targetId: user.id,
    ip,
  });

  return { ok: true };
}
