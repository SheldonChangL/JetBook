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
import {
  importUsers,
  markExistingEmails,
  parseUsersCsv,
  type ImportedUserResult,
  type ParsedUserRow,
} from "@/lib/admin/user-import";
import { createPasswordResetToken } from "@/lib/auth/password-reset";
import { deleteSessionCookie } from "@/lib/auth/session";
import { sendEmail } from "@/lib/email";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { isEmbeddingConfigured } from "@/lib/llm";
import { setAiDailyQuotaPerUser } from "@/lib/ai/quota";
import {
  testEmbeddingConnection,
  testLlmConnection,
  type ConnectionTestOutcome,
} from "@/lib/llm/settings";
import {
  enqueueReindexAll,
  getReindexAllStatus,
  type ReindexAllProgress,
} from "@/lib/jobs/queue";
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
    // 重設對象是自己時，本人全部 session 已於 lib 內撤銷（含當前這台）→ 一併清當前 cookie，
    // 不留無效 cookie（與 resetPassword 同一處理原則）。回傳的一次性密碼仍會顯示給操作者。
    if (data.userId === admin.id) await deleteSessionCookie();
    revalidatePath("/admin/users");
    return { ok: true, password };
  } catch (err) {
    return toResult(err);
  }
}

// ── 全庫重嵌（H-07，F-AI-02） ─────────────────────────────────────────

export type ReindexEnqueueResult =
  | { ok: true; jobId: string | null }
  | { ok: false; error: "EMBEDDING_NOT_CONFIGURED" };

/**
 * 觸發全庫重嵌（org admin only）：驗權限 → enqueue reindex-all 背景 job。
 * 未設定 embedding 端點時直接回錯（不排入無法執行的 job）。實際重嵌邏輯在 worker。
 */
export async function reindexAllAction(): Promise<ReindexEnqueueResult> {
  const admin = await requireOrgAdmin();
  if (!isEmbeddingConfigured()) {
    return { ok: false, error: "EMBEDDING_NOT_CONFIGURED" };
  }
  const jobId = await enqueueReindexAll();
  logger.info({ adminId: admin.id, jobId }, "admin: reindex-all enqueued");
  return { ok: true, jobId };
}

export type ReindexStatusResult =
  | { ok: true; state: string; progress: ReindexAllProgress | null }
  | { ok: false; error: "NOT_FOUND" };

const jobIdSchema = z.uuid();

/** 查詢 reindex-all job 狀態（org admin only；UI 輪詢進度／結果）。 */
export async function reindexStatusAction(jobId: string): Promise<ReindexStatusResult> {
  await requireOrgAdmin();
  const parsed = jobIdSchema.safeParse(jobId);
  if (!parsed.success) return { ok: false, error: "NOT_FOUND" };
  const status = await getReindexAllStatus(parsed.data);
  if (!status) return { ok: false, error: "NOT_FOUND" };
  return { ok: true, state: status.state, progress: status.output };
}

// ── AI 連線測試（L-03，F-ADMIN-04） ─────────────────────────────────

export type AiConnectionTestResult =
  | { ok: true; outcome: ConnectionTestOutcome }
  | { ok: false; error: "INVALID_TARGET" };

const connectionTargetSchema = z.enum(["llm", "embedding"]);

/**
 * 測試 AI 連線（org admin only）：驗權限 → 對指定 provider 實打最小請求。
 * 商業邏輯（實打與錯誤轉換）在 lib/llm/settings；action 僅薄殼。
 */
export async function testAiConnectionAction(target: string): Promise<AiConnectionTestResult> {
  await requireOrgAdmin();
  const parsed = connectionTargetSchema.safeParse(target);
  if (!parsed.success) return { ok: false, error: "INVALID_TARGET" };
  const outcome =
    parsed.data === "llm" ? await testLlmConnection() : await testEmbeddingConnection();
  return { ok: true, outcome };
}

// ── AI 每人每日配額（I-09，F-AI-11） ────────────────────────────────

export type SetAiQuotaResult = { ok: true } | { ok: false; error: "INVALID_QUOTA" };

// 配額為正整數（1 以上）或 null（不限）；上限給一個寬鬆的合理值防手誤打天文數字。
const aiQuotaSchema = z.object({
  quota: z.number().int().min(1).max(1_000_000).nullable(),
});

/**
 * 設定 AI 每人每日配額（org admin only）：驗權限 → 寫入 org_settings（單列 upsert）。
 * null＝不限。強制執行點在 /api/ai/chat（讀同一設定）。薄殼：商業邏輯在 lib/ai/quota。
 */
export async function setAiDailyQuotaAction(input: {
  quota: number | null;
}): Promise<SetAiQuotaResult> {
  const admin = await requireOrgAdmin();
  const parsed = aiQuotaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_QUOTA" };
  await setAiDailyQuotaPerUser(parsed.data.quota);
  logger.info({ adminId: admin.id, quota: parsed.data.quota }, "admin: ai daily quota set");
  revalidatePath("/admin/ai");
  return { ok: true };
}

// ── M4-02 CSV 批次建立使用者（issue #193） ──

const importCsvSchema = z.object({ csv: z.string().min(1).max(1_000_000) });

/** schema 擋下時給正確的錯誤碼：超長＝請分批（TOO_MANY_ROWS），其餘視為空檔。 */
function importSchemaError(csv: unknown): string {
  return typeof csv === "string" && csv.length > 1_000_000 ? "TOO_MANY_ROWS" : "EMPTY_FILE";
}

export type UserImportPreviewResult =
  | { ok: true; rows: ParsedUserRow[] }
  | { ok: false; error: string };

/** 預覽：解析 CSV 並比對 DB 既有 email，不改動任何資料。 */
export async function previewUserImportAction(input: {
  csv: string;
}): Promise<UserImportPreviewResult> {
  await requireOrgAdmin();
  const parsed = importCsvSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: importSchemaError(input.csv) };
  const result = parseUsersCsv(parsed.data.csv);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, rows: await markExistingEmails(result.rows) };
}

export type UserImportOutcome =
  | { ok: true; results: ImportedUserResult[]; created: number; skipped: number }
  | { ok: false; error: string };

/**
 * 執行匯入：重新解析（不信任 client 預覽）→ 批次建立（單交易）→ 稽核
 * → 歡迎信（重設密碼連結；寄送失敗不影響建立結果）。初始密碼僅此一次回傳。
 */
export async function importUsersAction(input: { csv: string }): Promise<UserImportOutcome> {
  const admin = await requireOrgAdmin();
  const parsed = importCsvSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: importSchemaError(input.csv) };
  const parseResult = parseUsersCsv(parsed.data.csv);
  if (!parseResult.ok) return { ok: false, error: parseResult.error };

  const results = await importUsers(parseResult.rows);
  const created = results.filter((r) => r.status === "created");

  await writeAudit({
    actorId: admin.id,
    action: "admin.user_import",
    targetType: "user",
    metadata: { total: results.length, created: created.length },
    ip: ipFromHeaders(await headers()),
  });
  logger.info(
    { adminId: admin.id, total: results.length, created: created.length },
    "admin: users imported from csv",
  );

  // 歡迎信：初始密碼不進信件，改寄重設連結（逾期可走忘記密碼）。失敗僅記 log。
  const t = await getTranslations("email");
  await Promise.allSettled(
    created.map(async (r) => {
      if (!r.userId) return;
      try {
        const { token } = await createPasswordResetToken(r.userId);
        const url = `${env.BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
        await sendEmail({
          to: r.email,
          subject: t("welcomeSubject"),
          text: t("welcomeBody", { name: r.name, email: r.email, url }),
        });
      } catch (err) {
        logger.warn({ err, email: r.email }, "welcome email failed");
      }
    }),
  );

  revalidatePath("/admin/users");
  return {
    ok: true,
    results,
    created: created.length,
    skipped: results.length - created.length,
  };
}
