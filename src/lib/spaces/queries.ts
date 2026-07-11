import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaceMembers, spaces, users } from "@/lib/db/schema";
import { accessibleSpaceCondition } from "@/lib/authz/spaces";
import type { User } from "@/lib/db/schema";

/** 列出使用者可存取的 Space（權限在 SQL 層過濾，非事後過濾）。 */
export async function listAccessibleSpaces(user: Pick<User, "id" | "orgRole">) {
  return db
    .select({
      id: spaces.id,
      slug: spaces.slug,
      name: spaces.name,
      description: spaces.description,
      icon: spaces.icon,
      visibility: spaces.visibility,
      collectionId: spaces.collectionId,
    })
    .from(spaces)
    .where(accessibleSpaceCondition(user))
    .orderBy(desc(spaces.createdAt));
}

/** 列出 Space 管理員（403 頁 M1 顯示聯絡資訊用，設計規範 §3.12）。 */
export async function listSpaceAdmins(spaceId: string) {
  return db
    .select({ name: users.name, email: users.email })
    .from(spaceMembers)
    .innerJoin(users, eq(users.id, spaceMembers.userId))
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.role, "admin"),
        eq(users.isActive, true),
      ),
    )
    .orderBy(users.name);
}
