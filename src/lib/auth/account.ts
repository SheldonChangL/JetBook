import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { hashPassword, isPasswordAcceptable, verifyPassword } from "@/lib/auth/password";
import { invalidateUserSessions } from "@/lib/auth/session";

/**
 * 使用者自助帳號設定商業邏輯（B-08 個人設定頁）。
 * 權限斷言（session 驗證）在 action 薄殼層；此層只負責資料規則：
 * - 顯示名稱更新
 * - 自助變更密碼（驗舊密碼 → 密碼原則 → 覆寫 hash → 撤銷本人全部 session）
 * - 外觀偏好持久化（users.theme_preference，跨裝置同步來源）
 */

/** 外觀偏好合法值；null（未設定）視同 system。 */
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** 更新顯示名稱（已由 action 層 trim 與長度驗證）。 */
export async function updateDisplayName(userId: string, name: string): Promise<void> {
  const [updated] = await db
    .update(users)
    .set({ name, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (!updated) throw new Error("NOT_FOUND");
}

/**
 * 持久化外觀偏好。system 以 NULL 儲存（未設定＝跟隨系統），其餘存字面值。
 */
export async function updateThemePreference(
  userId: string,
  theme: ThemePreference,
): Promise<void> {
  const [updated] = await db
    .update(users)
    .set({ themePreference: theme === "system" ? null : theme, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (!updated) throw new Error("NOT_FOUND");
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "invalid_current" | "weak" | "same" | "not_local" | "not_found" };

/**
 * 自助變更密碼（驗收 1）：
 * 1. OIDC 帳號無本地密碼 → not_local（改由 SSO 端管理）
 * 2. 驗舊密碼失敗 → invalid_current
 * 3. 新密碼與舊密碼相同 → same
 * 4. 新密碼不符原則 → weak
 * 5. 全數通過 → 覆寫 hash 並撤銷本人全部 session（含當前；由 action 重建當前 session）
 *
 * 撤銷全部 session 後由呼叫端（action）為當前裝置重建 session 與 cookie，
 * 效果為「其他裝置立即登出、本人維持登入」（F-SEC-02 一致）。
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const user: User | undefined = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return { ok: false, reason: "not_found" };
  if (!user.passwordHash) return { ok: false, reason: "not_local" };

  const currentOk = await verifyPassword(user.passwordHash, currentPassword);
  if (!currentOk) return { ok: false, reason: "invalid_current" };

  if (newPassword === currentPassword) return { ok: false, reason: "same" };
  if (!isPasswordAcceptable(newPassword)) return { ok: false, reason: "weak" };

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await invalidateUserSessions(userId);
  return { ok: true };
}
