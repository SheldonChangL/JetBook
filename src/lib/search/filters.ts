import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, spaces, users, type User } from "@/lib/db/schema";
import { accessibleSpaceCondition } from "@/lib/authz/spaces";

export interface SearchAuthor {
  id: string;
  name: string;
}

/**
 * 搜尋作者過濾器（F-SEARCH-03）的候選作者清單。
 * 只列出「使用者可讀 Space 內、未刪除頁面」的作者（created_by），權限在 SQL 層過濾，
 * 避免透過作者清單洩漏無權空間的成員。回傳去重且依姓名排序。
 */
export async function listSearchAuthors(
  user: Pick<User, "id" | "orgRole">,
): Promise<SearchAuthor[]> {
  return db
    .selectDistinct({ id: users.id, name: users.name })
    .from(pages)
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .innerJoin(users, eq(users.id, pages.createdBy))
    .where(and(isNull(pages.deletedAt), accessibleSpaceCondition(user)))
    .orderBy(users.name);
}
