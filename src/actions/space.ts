"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { spaceMembers, spaces, type SpaceRole } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { getSpaceRole, roleAtLeast } from "@/lib/authz/spaces";
import { logger } from "@/lib/logger";

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  // 中文標題產不出 ASCII slug 時退化為短碼
  return base && /[a-z0-9]/.test(base) ? base.slice(0, 48) : `s-${crypto.randomUUID().slice(0, 8)}`;
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  for (let i = 2; ; i += 1) {
    const existing = await db.query.spaces.findFirst({ where: eq(spaces.slug, candidate) });
    if (!existing) return candidate;
    candidate = `${base}-${i}`;
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().max(16).optional(),
});

export async function createSpace(input: z.infer<typeof createSchema>) {
  const { user } = await requireSession();
  const data = createSchema.parse(input);
  const slug = await uniqueSlug(data.name);

  const space = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(spaces)
      .values({ ...data, slug, createdBy: user.id })
      .returning();
    if (!created) throw new Error("space 建立失敗");
    // 建立者成為該 space admin
    await tx.insert(spaceMembers).values({ spaceId: created.id, userId: user.id, role: "admin" });
    return created;
  });

  logger.info({ userId: user.id, spaceId: space.id }, "space created");
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
  const role = await getSpaceRole(user, data.spaceId);
  if (!roleAtLeast(role, "admin")) {
    throw new Error("FORBIDDEN");
  }
  const { spaceId, ...fields } = data;
  await db.update(spaces).set(fields).where(eq(spaces.id, spaceId));
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
  const actorRole = await getSpaceRole(user, data.spaceId);
  if (!roleAtLeast(actorRole, "admin")) {
    throw new Error("FORBIDDEN");
  }

  await db.transaction(async (tx) => {
    const admins = await tx
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, data.spaceId), eq(spaceMembers.role, "admin")));
    const isLastAdmin =
      admins.length === 1 && admins[0]?.userId === data.userId && data.role !== "admin";
    if (isLastAdmin) throw new Error("LAST_ADMIN");

    if (data.role === null) {
      await tx
        .delete(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, data.spaceId), eq(spaceMembers.userId, data.userId)));
      return;
    }
    const role: SpaceRole = data.role;
    await tx
      .insert(spaceMembers)
      .values({ spaceId: data.spaceId, userId: data.userId, role })
      .onConflictDoUpdate({
        target: [spaceMembers.spaceId, spaceMembers.userId],
        set: { role },
      });
  });
  revalidatePath("/spaces");
}
