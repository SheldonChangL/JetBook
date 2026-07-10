"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";
import { assertOrgAdmin } from "@/lib/authz/permission";
import {
  createUser,
  resetUserPassword,
  setUserActive,
  setUserOrgRole,
} from "@/lib/admin/users";
import { logger } from "@/lib/logger";

/**
 * 管理後台 server action 薄殼（L-01）：驗 session → assertOrgAdmin → 呼叫 lib 層。
 * 業務規則錯誤（EMAIL_TAKEN / LAST_ORG_ADMIN / WEAK_PASSWORD）以 result 回傳供 UI 呈現，
 * 其餘錯誤照常拋出。
 */

export type AdminActionResult = { ok: true } | { ok: false; error: string };

const KNOWN_ERRORS = new Set(["EMAIL_TAKEN", "LAST_ORG_ADMIN", "WEAK_PASSWORD", "NOT_FOUND"]);

async function requireOrgAdmin() {
  const { user } = await requireSession();
  assertOrgAdmin(user);
  return user;
}

function toResult(err: unknown): { ok: false; error: string } {
  if (err instanceof Error && KNOWN_ERRORS.has(err.message)) {
    return { ok: false, error: err.message };
  }
  throw err;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(10).max(128),
  orgRole: z.enum(["admin", "member"]),
});

export async function createUserAction(
  input: z.infer<typeof createSchema>,
): Promise<AdminActionResult> {
  const admin = await requireOrgAdmin();
  const data = createSchema.parse(input);
  try {
    const created = await createUser(data);
    logger.info({ adminId: admin.id, userId: created.id }, "admin: user created");
  } catch (err) {
    return toResult(err);
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

const activeSchema = z.object({ userId: z.uuid(), isActive: z.boolean() });

export async function setUserActiveAction(
  input: z.infer<typeof activeSchema>,
): Promise<AdminActionResult> {
  const admin = await requireOrgAdmin();
  const data = activeSchema.parse(input);
  try {
    await setUserActive(data.userId, data.isActive);
    logger.info(
      { adminId: admin.id, userId: data.userId, isActive: data.isActive },
      "admin: user active toggled",
    );
  } catch (err) {
    return toResult(err);
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

const roleSchema = z.object({ userId: z.uuid(), orgRole: z.enum(["admin", "member"]) });

export async function setUserOrgRoleAction(
  input: z.infer<typeof roleSchema>,
): Promise<AdminActionResult> {
  const admin = await requireOrgAdmin();
  const data = roleSchema.parse(input);
  try {
    await setUserOrgRole(data.userId, data.orgRole);
    logger.info(
      { adminId: admin.id, userId: data.userId, orgRole: data.orgRole },
      "admin: user org role changed",
    );
  } catch (err) {
    return toResult(err);
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

const resetSchema = z.object({ userId: z.uuid() });

export type ResetPasswordResult =
  | { ok: true; password: string }
  | { ok: false; error: string };

/** 強制重設密碼：回傳一次性明文密碼（僅顯示一次，不落任何 log）。 */
export async function resetUserPasswordAction(
  input: z.infer<typeof resetSchema>,
): Promise<ResetPasswordResult> {
  const admin = await requireOrgAdmin();
  const data = resetSchema.parse(input);
  try {
    const password = await resetUserPassword(data.userId);
    logger.info({ adminId: admin.id, userId: data.userId }, "admin: user password reset");
    revalidatePath("/admin/users");
    return { ok: true, password };
  } catch (err) {
    return toResult(err);
  }
}
