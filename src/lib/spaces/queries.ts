import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
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
    })
    .from(spaces)
    .where(accessibleSpaceCondition(user))
    .orderBy(desc(spaces.createdAt));
}
