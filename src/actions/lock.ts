"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { assertCan } from "@/lib/authz/permission";
import { acquireLock, heartbeatLock, releaseLock, getLockState } from "@/lib/pages/lock";

async function editorFor(pageId: string) {
  const { user } = await requireSession();
  const page = await db.query.pages.findFirst({ where: eq(pages.id, pageId) });
  if (!page || page.deletedAt) throw new Error("NOT_FOUND");
  await assertCan(user, "page.edit", { type: "page", spaceId: page.spaceId });
  return user;
}

/** 進入編輯時取鎖（force 供 Admin 搶鎖）。 */
export async function acquireLockAction(pageId: string, force = false) {
  const user = await editorFor(pageId);
  const acquired = await acquireLock(pageId, user.id, { force });
  const state = await getLockState(pageId, user.id);
  return { acquired, state };
}

/**
 * 心跳續租。仍持鎖回傳 { held: true }；鎖已被搶/接手回傳 { held: false, lockedByName }，
 * 供編輯器即時降級唯讀並提示新持有者（F-COLLAB-01 驗收 3）。
 */
export async function heartbeatLockAction(pageId: string) {
  const { user } = await requireSession();
  const held = await heartbeatLock(pageId, user.id);
  if (held) return { held: true as const, lockedByName: null };
  const state = await getLockState(pageId, user.id);
  return { held: false as const, lockedByName: state.lockedByName };
}

export async function releaseLockAction(pageId: string) {
  const { user } = await requireSession();
  await releaseLock(pageId, user.id);
}
