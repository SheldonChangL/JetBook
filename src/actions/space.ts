"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";
import { assertCan, assertOrgAdmin } from "@/lib/authz/permission";
import { createSpaceCore } from "@/lib/spaces/create";
import {
  restoreSpace as restoreSpaceRow,
  setSpaceArchived,
  setSpaceGroupRole,
  setSpaceMemberRole,
  softDeleteSpace,
  updateSpaceFields,
} from "@/lib/spaces/manage";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// slug 產生與建立核心已抽至 lib/spaces/create.ts（M4-13：web 與 API 寫入共用）

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().max(16).optional(),
});

export async function createSpace(input: z.infer<typeof createSchema>) {
  const { user } = await requireSession();
  const data = createSchema.parse(input);

  const space = await createSpaceCore(user.id, data);

  logger.info({ userId: user.id, spaceId: space.id }, "space created");
  await writeAudit({
    actorId: user.id,
    action: "space.create",
    targetType: "space",
    targetId: space.id,
    metadata: { name: data.name, slug: space.slug },
    ip: ipFromHeaders(await headers()),
  });
  revalidatePath("/spaces");
  return { slug: space.slug };
}

const updateSchema = z.object({
  spaceId: z.uuid(),
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  icon: z.string().trim().max(16).nullable().optional(),
  visibility: z.enum(["private", "org_read", "org_write"]).optional(),
});

export async function updateSpace(input: z.infer<typeof updateSchema>) {
  const { user } = await requireSession();
  const data = updateSchema.parse(input);
  await assertCan(user, "space.manage", { type: "space", spaceId: data.spaceId });
  const { spaceId, ...fields } = data;
  await updateSpaceFields(spaceId, fields);
  await writeAudit({
    actorId: user.id,
    action: "space.update",
    targetType: "space",
    targetId: spaceId,
    metadata: { fields },
    ip: ipFromHeaders(await headers()),
  });
  revalidatePath("/spaces");
}

const memberSchema = z.object({
  spaceId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(["admin", "editor", "commenter", "viewer"]).nullable(),
});

/** 設定/移除成員角色；role=null 移除。保護：不可移除最後一位 admin。 */
export async function setSpaceMember(input: z.infer<typeof memberSchema>) {
  const { user } = await requireSession();
  const data = memberSchema.parse(input);
  await assertCan(user, "space.manage", { type: "space", spaceId: data.spaceId });

  await setSpaceMemberRole(data.spaceId, data.userId, data.role);

  await writeAudit({
    actorId: user.id,
    action: "space.member_set",
    targetType: "space",
    targetId: data.spaceId,
    metadata: { memberId: data.userId, role: data.role },
    ip: ipFromHeaders(await headers()),
  });
  revalidatePath("/spaces");
  revalidatePath("/s/[spaceSlug]", "layout");
}

const groupSchema = z.object({
  spaceId: z.uuid(),
  groupId: z.uuid(),
  role: z.enum(["admin", "editor", "commenter", "viewer"]).nullable(),
});

/**
 * 掛載/變更/移除群組於某 space（K-03 主體泛化）。role=null 移除掛載。
 * space admin（space.manage）可執行；群組全體成員即以該角色繼承存取權。
 */
export async function setSpaceGroup(input: z.infer<typeof groupSchema>) {
  const { user } = await requireSession();
  const data = groupSchema.parse(input);
  await assertCan(user, "space.manage", { type: "space", spaceId: data.spaceId });

  await setSpaceGroupRole(data.spaceId, data.groupId, data.role);

  await writeAudit({
    actorId: user.id,
    action: "space.group_set",
    targetType: "space",
    targetId: data.spaceId,
    metadata: { groupId: data.groupId, role: data.role },
    ip: ipFromHeaders(await headers()),
  });
  revalidatePath("/spaces");
  revalidatePath("/s/[spaceSlug]", "layout");
}

const archiveSchema = z.object({
  spaceId: z.uuid(),
  archived: z.boolean(),
});

/** 封存/取消封存 Space（archived_at）；封存後自列表與搜尋隱藏，內容保留可還原。 */
export async function archiveSpace(input: z.infer<typeof archiveSchema>) {
  const { user } = await requireSession();
  const data = archiveSchema.parse(input);
  await assertCan(user, "space.manage", { type: "space", spaceId: data.spaceId });

  await setSpaceArchived(data.spaceId, data.archived);

  await writeAudit({
    actorId: user.id,
    action: data.archived ? "space.archive" : "space.unarchive",
    targetType: "space",
    targetId: data.spaceId,
    ip: ipFromHeaders(await headers()),
  });
  revalidatePath("/spaces");
  revalidatePath("/s/[spaceSlug]", "layout");
}

const deleteSchema = z.object({ spaceId: z.uuid() });

/**
 * 軟刪除 Space（deleted_at）；space admin（space.manage）可執行。刪除後空間與其所有頁面
 * 自列表、搜尋、RAG 全面隱藏，內容保留，org admin 可於 30 天內於後台還原，逾期由 cron 清除。
 */
export async function deleteSpace(input: z.infer<typeof deleteSchema>) {
  const { user } = await requireSession();
  const data = deleteSchema.parse(input);
  await assertCan(user, "space.manage", { type: "space", spaceId: data.spaceId });

  await softDeleteSpace(data.spaceId);

  await writeAudit({
    actorId: user.id,
    action: "space.delete",
    targetType: "space",
    targetId: data.spaceId,
    ip: ipFromHeaders(await headers()),
  });
  revalidatePath("/spaces");
  revalidatePath("/s/[spaceSlug]", "layout");
  revalidatePath("/admin/spaces");
}

export type RestoreSpaceResult = { ok: true } | { ok: false; error: "NOT_FOUND" };

/**
 * 還原軟刪 Space（org admin only，後台 §L-01）：保留期（30 天）內清除 deleted_at，
 * 空間與頁面即恢復可見。逾期或不存在回 NOT_FOUND 供 UI 提示。
 */
export async function restoreSpaceAction(
  input: z.infer<typeof deleteSchema>,
): Promise<RestoreSpaceResult> {
  const { user } = await requireSession();
  assertOrgAdmin(user);
  const data = deleteSchema.parse(input);

  let restored;
  try {
    restored = await restoreSpaceRow(data.spaceId);
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return { ok: false, error: "NOT_FOUND" };
    }
    throw err;
  }

  await writeAudit({
    actorId: user.id,
    action: "space.restore",
    targetType: "space",
    targetId: data.spaceId,
    metadata: { slug: restored.slug },
    ip: ipFromHeaders(await headers()),
  });
  revalidatePath("/spaces");
  revalidatePath("/admin/spaces");
  return { ok: true };
}
