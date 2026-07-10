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

export async function heartbeatLockAction(pageId: string) {
  const { user } = await requireSession();
  return heartbeatLock(pageId, user.id);
}

export async function releaseLockAction(pageId: string) {
  const { user } = await requireSession();
  await releaseLock(pageId, user.id);
}
