import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  groupMembers,
  groups,
  pages,
  spaceMemberGroups,
  spaceMembers,
  spaces,
  users,
  type PageKind,
  type SpaceRole,
  type SpaceVisibility,
} from "@/lib/db/schema";

/** 整合測試 seed 工具（N-01）：每筆資料帶隨機後綴，測試間不互相干擾。 */

export async function seedUser(overrides: { orgRole?: "admin" | "member"; name?: string } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const [user] = await db
    .insert(users)
    .values({
      email: `it-${suffix}@test.jetbook`,
      name: overrides.name ?? `測試使用者 ${suffix}`,
      passwordHash: "not-a-real-hash",
      orgRole: overrides.orgRole ?? "member",
    })
    .returning();
  if (!user) throw new Error("seedUser failed");
  return user;
}

export async function seedSpace(
  createdBy: string,
  overrides: { visibility?: SpaceVisibility; aiIndexingEnabled?: boolean; name?: string } = {},
) {
  const suffix = randomUUID().slice(0, 8);
  const [space] = await db
    .insert(spaces)
    .values({
      slug: `it-space-${suffix}`,
      name: overrides.name ?? `測試空間 ${suffix}`,
      visibility: overrides.visibility ?? "private",
      aiIndexingEnabled: overrides.aiIndexingEnabled ?? true,
      createdBy,
    })
    .returning();
  if (!space) throw new Error("seedSpace failed");
  return space;
}

export async function addMember(spaceId: string, userId: string, role: SpaceRole) {
  await db.insert(spaceMembers).values({ spaceId, userId, role });
}

export async function seedGroup(overrides: { name?: string } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const [group] = await db
    .insert(groups)
    .values({ name: overrides.name ?? `測試群組 ${suffix}` })
    .returning();
  if (!group) throw new Error("seedGroup failed");
  return group;
}

export async function addGroupMember(groupId: string, userId: string) {
  await db.insert(groupMembers).values({ groupId, userId }).onConflictDoNothing();
}

export async function removeGroupMemberRow(groupId: string, userId: string) {
  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
}

export async function attachGroupToSpace(spaceId: string, groupId: string, role: SpaceRole) {
  await db
    .insert(spaceMemberGroups)
    .values({ spaceId, groupId, role })
    .onConflictDoUpdate({
      target: [spaceMemberGroups.spaceId, spaceMemberGroups.groupId],
      set: { role },
    });
}

export async function seedPage(
  spaceId: string,
  overrides: {
    title?: string;
    contentText?: string;
    parentId?: string | null;
    createdBy?: string;
    updatedAt?: Date;
    /** 節點型別（C-11）；預設 page。 */
    kind?: PageKind;
    /** external_link 目標 URL。 */
    externalUrl?: string | null;
  } = {},
) {
  const suffix = randomUUID().slice(0, 8);
  const [page] = await db
    .insert(pages)
    .values({
      spaceId,
      parentId: overrides.parentId ?? null,
      slug: `it-page-${suffix}`,
      title: overrides.title ?? `測試頁面 ${suffix}`,
      contentText: overrides.contentText ?? "",
      position: "a0",
      ...(overrides.kind ? { kind: overrides.kind } : {}),
      ...(overrides.externalUrl !== undefined ? { externalUrl: overrides.externalUrl } : {}),
      ...(overrides.createdBy ? { createdBy: overrides.createdBy } : {}),
      ...(overrides.updatedAt ? { updatedAt: overrides.updatedAt } : {}),
    })
    .returning();
  if (!page) throw new Error("seedPage failed");
  return page;
}
