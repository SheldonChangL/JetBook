import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSessionToken, validateSessionToken, type SessionValidationResult } from "./session";

/**
 * 每請求 session 解析（React cache()：同一請求內多次呼叫只查一次 DB）。
 * middleware 只做 cookie 存在性快篩（edge 無 DB）；真正的驗證在這裡（主防線）。
 */
export const getCurrentSession = cache(async (): Promise<SessionValidationResult | null> => {
  const token = await getSessionToken();
  if (!token) return null;
  return validateSessionToken(token);
});

/** 取得已驗證 session，未登入即導向 /login（帶 returnTo 供登入後回原頁）。 */
export async function requireSession(returnTo?: string): Promise<SessionValidationResult> {
  const result = await getCurrentSession();
  if (!result) {
    const target = returnTo && isSafeReturnTo(returnTo) ? returnTo : undefined;
    redirect(target ? `/login?returnTo=${encodeURIComponent(target)}` : "/login");
  }
  return result;
}

/** returnTo 僅允許站內相對路徑（防 open redirect）。 */
export function isSafeReturnTo(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}
