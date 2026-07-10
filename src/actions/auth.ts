"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  deleteSessionCookie,
  getSessionToken,
  invalidateSession,
  setSessionCookie,
  validateSessionToken,
} from "@/lib/auth/session";
import {
  getLockRemainingSeconds,
  recordLoginFailure,
  resetLoginFailures,
} from "@/lib/auth/throttle";
import { loginRateLimiter } from "@/lib/rate-limit";
import { requestLogger } from "@/lib/logger";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
  remember: z.coerce.boolean().default(false),
});

export type LoginState =
  | { status: "idle" }
  | { status: "error"; code: "invalid" | "rateLimited" }
  | { status: "error"; code: "locked"; retryAfterSeconds: number };

/** 帳號不存在時也跑一次雜湊驗證，避免時間差洩漏帳號存在性（防枚舉）。 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("jetbook-dummy-password-for-timing");
  return dummyHashPromise;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const requestHeaders = await headers();
  const log = requestLogger(new Headers(requestHeaders));
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    remember: formData.get("remember"),
  });
  if (!parsed.success) {
    return { status: "error", code: "invalid" };
  }
  const { email, password, remember } = parsed.data;

  // 第一道：IP rate limit（5 次/分）
  const rate = loginRateLimiter.check(`login:${ip}`);
  if (!rate.allowed) {
    log.warn({ ip }, "login rate limited");
    return { status: "error", code: "rateLimited" };
  }

  // 第二道：帳號失敗鎖定（遞增延遲）
  const lockSeconds = await getLockRemainingSeconds(email);
  if (lockSeconds > 0) {
    return { status: "error", code: "locked", retryAfterSeconds: lockSeconds };
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });

  const passwordOk = user?.passwordHash
    ? await verifyPassword(user.passwordHash, password)
    : (await verifyPassword(await getDummyHash(), password), false);

  if (!user || !user.isActive || !passwordOk) {
    await recordLoginFailure(email);
    log.info({ email, ip, reason: !user ? "no-user" : !user.isActive ? "inactive" : "password" },
      "login failed");
    // 錯誤訊息不區分帳號不存在／密碼錯誤／已停用（防枚舉）
    return { status: "error", code: "invalid" };
  }

  await resetLoginFailures(email);
  const { token, session } = await createSession(user.id, {
    ip,
    userAgent: requestHeaders.get("user-agent"),
  });
  // 記住我：persistent cookie（絕對逾時）；否則 session cookie（關瀏覽器即失效）
  await setSessionCookie(token, remember ? session.expiresAt : undefined);
  log.info({ userId: user.id, ip }, "login success");
  redirect("/");
}

export async function logout(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    const result = await validateSessionToken(token);
    if (result) {
      await invalidateSession(result.session.id);
    }
  }
  await deleteSessionCookie();
  redirect("/login");
}
