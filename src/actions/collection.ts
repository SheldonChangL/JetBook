"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";
import { assertOrgAdmin } from "@/lib/authz/permission";
import {
  assignSpaceCollection,
  createCollection,
  deleteCollection,
  renameCollection,
} from "@/lib/spaces/collections";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * Collection 分組 server action 薄殼（C-09，F-ORG-03）：驗 session → assertOrgAdmin → 呼叫 lib。
 * 權限：org admin 管 collection（建立／改名／刪除／指派）。
 * 業務錯誤（NOT_FOUND / COLLECTION_NOT_FOUND / SPACE_NOT_FOUND）以 result 回傳供 UI 呈現。
 */

export type CollectionActionResult = { ok: true } | { ok: false; error: string };

const KNOWN_ERRORS = new Set(["NOT_FOUND", "COLLECTION_NOT_FOUND", "SPACE_NOT_FOUND"]);

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

/** collection 變更影響 spaces 頁分組與側欄「我的空間」分組，兩處一併 revalidate。 */
function revalidateGrouping() {
  revalidatePath("/spaces");
  revalidatePath("/", "layout");
}

const nameSchema = z.string().trim().min(1).max(80);
const createSchema = z.object({ name: nameSchema });

export async function createCollectionAction(
  input: z.infer<typeof createSchema>,
): Promise<CollectionActionResult> {
  const admin = await requireOrgAdmin();
  const data = createSchema.parse(input);
  const collection = await createCollection(data.name);
  await writeAudit({
    actorId: admin.id,
    action: "collection.create",
    targetType: "collection",
    targetId: collection.id,
    metadata: { name: data.name },
    ip: ipFromHeaders(await headers()),
  });
  logger.info({ adminId: admin.id, collectionId: collection.id }, "admin: collection created");
  revalidateGrouping();
  return { ok: true };
}

const renameSchema = z.object({ collectionId: z.uuid(), name: nameSchema });

export async function renameCollectionAction(
  input: z.infer<typeof renameSchema>,
): Promise<CollectionActionResult> {
  const admin = await requireOrgAdmin();
  const data = renameSchema.parse(input);
  try {
    await renameCollection(data.collectionId, data.name);
  } catch (err) {
    return toResult(err);
  }
  await writeAudit({
    actorId: admin.id,
    action: "collection.update",
    targetType: "collection",
    targetId: data.collectionId,
    metadata: { name: data.name },
    ip: ipFromHeaders(await headers()),
  });
  revalidateGrouping();
  return { ok: true };
}

const idSchema = z.object({ collectionId: z.uuid() });

export async function deleteCollectionAction(
  input: z.infer<typeof idSchema>,
): Promise<CollectionActionResult> {
  const admin = await requireOrgAdmin();
  const data = idSchema.parse(input);
  try {
    await deleteCollection(data.collectionId);
  } catch (err) {
    return toResult(err);
  }
  await writeAudit({
    actorId: admin.id,
    action: "collection.delete",
    targetType: "collection",
    targetId: data.collectionId,
    ip: ipFromHeaders(await headers()),
  });
  logger.info({ adminId: admin.id, collectionId: data.collectionId }, "admin: collection deleted");
  revalidateGrouping();
  return { ok: true };
}

const assignSchema = z.object({ spaceId: z.uuid(), collectionId: z.uuid().nullable() });

export async function assignSpaceCollectionAction(
  input: z.infer<typeof assignSchema>,
): Promise<CollectionActionResult> {
  const admin = await requireOrgAdmin();
  const data = assignSchema.parse(input);
  try {
    await assignSpaceCollection(data.spaceId, data.collectionId);
  } catch (err) {
    return toResult(err);
  }
  await writeAudit({
    actorId: admin.id,
    action: "collection.assign_space",
    targetType: "space",
    targetId: data.spaceId,
    metadata: { collectionId: data.collectionId },
    ip: ipFromHeaders(await headers()),
  });
  revalidateGrouping();
  return { ok: true };
}
