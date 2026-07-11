"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";
import { assertOrgAdmin } from "@/lib/authz/permission";
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  importGroupMembersByEmails,
  parseEmails,
  removeGroupMember,
  updateGroup,
  type ImportEmailsResult,
} from "@/lib/admin/groups";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * 群組管理 server action 薄殼（K-03，F-ADMIN-02）：驗 session → assertOrgAdmin → 呼叫 lib 層。
 * 業務規則錯誤（NAME_TAKEN / NOT_FOUND）以 result 回傳供 UI 呈現，其餘錯誤照常拋出。
 */

export type GroupActionResult = { ok: true } | { ok: false; error: string };

const KNOWN_ERRORS = new Set(["NAME_TAKEN", "NOT_FOUND"]);

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

const nameSchema = z.string().trim().min(1).max(80);
const descriptionSchema = z.string().trim().max(300).nullish();

const createSchema = z.object({ name: nameSchema, description: descriptionSchema });

export async function createGroupAction(
  input: z.infer<typeof createSchema>,
): Promise<GroupActionResult> {
  const admin = await requireOrgAdmin();
  const data = createSchema.parse(input);
  let group;
  try {
    group = await createGroup({ name: data.name, description: data.description ?? null });
  } catch (err) {
    return toResult(err);
  }
  await writeAudit({
    actorId: admin.id,
    action: "group.create",
    targetType: "group",
    targetId: group.id,
    metadata: { name: data.name },
    ip: ipFromHeaders(await headers()),
  });
  logger.info({ adminId: admin.id, groupId: group.id }, "admin: group created");
  revalidatePath("/admin/groups");
  return { ok: true };
}

const updateSchema = z.object({
  groupId: z.uuid(),
  name: nameSchema,
  description: descriptionSchema,
});

export async function updateGroupAction(
  input: z.infer<typeof updateSchema>,
): Promise<GroupActionResult> {
  const admin = await requireOrgAdmin();
  const data = updateSchema.parse(input);
  try {
    await updateGroup(data.groupId, { name: data.name, description: data.description ?? null });
  } catch (err) {
    return toResult(err);
  }
  await writeAudit({
    actorId: admin.id,
    action: "group.update",
    targetType: "group",
    targetId: data.groupId,
    metadata: { name: data.name },
    ip: ipFromHeaders(await headers()),
  });
  revalidatePath("/admin/groups");
  revalidatePath(`/admin/groups/${data.groupId}`);
  return { ok: true };
}

const groupIdSchema = z.object({ groupId: z.uuid() });

export async function deleteGroupAction(
  input: z.infer<typeof groupIdSchema>,
): Promise<GroupActionResult> {
  const admin = await requireOrgAdmin();
  const data = groupIdSchema.parse(input);
  try {
    await deleteGroup(data.groupId);
  } catch (err) {
    return toResult(err);
  }
  await writeAudit({
    actorId: admin.id,
    action: "group.delete",
    targetType: "group",
    targetId: data.groupId,
    ip: ipFromHeaders(await headers()),
  });
  logger.info({ adminId: admin.id, groupId: data.groupId }, "admin: group deleted");
  revalidatePath("/admin/groups");
  // 群組刪除連帶解除 space 掛載——影響權限，讓空間列表與內容重新解析。
  revalidatePath("/spaces");
  revalidatePath("/s/[spaceSlug]", "layout");
  return { ok: true };
}

const memberSchema = z.object({ groupId: z.uuid(), userId: z.uuid() });

export async function addGroupMemberAction(
  input: z.infer<typeof memberSchema>,
): Promise<GroupActionResult> {
  const admin = await requireOrgAdmin();
  const data = memberSchema.parse(input);
  const added = await addGroupMember(data.groupId, data.userId);
  if (added) {
    await writeAudit({
      actorId: admin.id,
      action: "group.member_add",
      targetType: "group",
      targetId: data.groupId,
      metadata: { memberId: data.userId },
      ip: ipFromHeaders(await headers()),
    });
  }
  revalidatePath(`/admin/groups/${data.groupId}`);
  revalidatePath("/admin/groups");
  revalidatePath("/s/[spaceSlug]", "layout");
  return { ok: true };
}

export async function removeGroupMemberAction(
  input: z.infer<typeof memberSchema>,
): Promise<GroupActionResult> {
  const admin = await requireOrgAdmin();
  const data = memberSchema.parse(input);
  await removeGroupMember(data.groupId, data.userId);
  await writeAudit({
    actorId: admin.id,
    action: "group.member_remove",
    targetType: "group",
    targetId: data.groupId,
    metadata: { memberId: data.userId },
    ip: ipFromHeaders(await headers()),
  });
  revalidatePath(`/admin/groups/${data.groupId}`);
  revalidatePath("/admin/groups");
  // 移出群組即失效（F-SEC-06）：讓依賴該群組取得存取權的空間重新解析。
  revalidatePath("/spaces");
  revalidatePath("/s/[spaceSlug]", "layout");
  return { ok: true };
}

const importSchema = z.object({ groupId: z.uuid(), text: z.string().max(50000) });

export type ImportMembersResult =
  | { ok: true; result: ImportEmailsResult }
  | { ok: false; error: string };

/** CSV 批次貼上 email 匯入成員（F-ADMIN-02）：解析 → 比對現有帳號 → 加入，回報未命中。 */
export async function importGroupMembersAction(
  input: z.infer<typeof importSchema>,
): Promise<ImportMembersResult> {
  const admin = await requireOrgAdmin();
  const data = importSchema.parse(input);
  const emails = parseEmails(data.text);
  const result = await importGroupMembersByEmails(data.groupId, emails);
  if (result.added > 0) {
    await writeAudit({
      actorId: admin.id,
      action: "group.member_import",
      targetType: "group",
      targetId: data.groupId,
      metadata: { added: result.added, notFound: result.notFound.length },
      ip: ipFromHeaders(await headers()),
    });
  }
  revalidatePath(`/admin/groups/${data.groupId}`);
  revalidatePath("/admin/groups");
  revalidatePath("/s/[spaceSlug]", "layout");
  return { ok: true, result };
}
