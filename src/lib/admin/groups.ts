import "server-only";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { groupMembers, groups, users, type Group } from "@/lib/db/schema";

/**
 * 使用者群組管理商業邏輯（K-03，F-ADMIN-02）。
 * 權限斷言在 action 薄殼層（assertOrgAdmin）；此層只負責資料規則：
 * - 群組名稱唯一（NAME_TAKEN）
 * - 群組不存在（NOT_FOUND）
 * - 成員新增／移除、CSV email 批次匯入（比對現有使用者，回報未命中）
 * 抽出至 lib 以符合薄殼原則並可用真 PG 直接驗證。
 */

/** PG unique violation（23505）；drizzle 會包一層，原始錯誤在 cause 鏈。 */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  while (typeof current === "object" && current !== null) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: Date;
}

/** 列出全部群組（含成員數），依名稱排序。 */
export async function listGroups(): Promise<GroupRow[]> {
  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      createdAt: groups.createdAt,
      memberCount: count(groupMembers.userId),
    })
    .from(groups)
    .leftJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .groupBy(groups.id)
    .orderBy(asc(groups.name));
  return rows.map((r) => ({ ...r, memberCount: Number(r.memberCount) }));
}

/** 取單一群組；不存在回 null。 */
export async function getGroup(groupId: string): Promise<Group | null> {
  return (await db.query.groups.findFirst({ where: eq(groups.id, groupId) })) ?? null;
}

export interface CreateGroupInput {
  name: string;
  description?: string | null;
}

/** 建立群組；名稱重複擲 NAME_TAKEN。 */
export async function createGroup(input: CreateGroupInput): Promise<Group> {
  try {
    const [created] = await db
      .insert(groups)
      .values({ name: input.name, description: input.description ?? null })
      .returning();
    if (!created) throw new Error("群組建立失敗");
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("NAME_TAKEN");
    throw err;
  }
}

/** 更新群組名稱／描述；名稱重複擲 NAME_TAKEN、不存在擲 NOT_FOUND。 */
export async function updateGroup(groupId: string, input: CreateGroupInput): Promise<void> {
  try {
    const [updated] = await db
      .update(groups)
      .set({ name: input.name, description: input.description ?? null })
      .where(eq(groups.id, groupId))
      .returning({ id: groups.id });
    if (!updated) throw new Error("NOT_FOUND");
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("NAME_TAKEN");
    throw err;
  }
}

/** 刪除群組；FK cascade 連帶清除成員與 space 掛載（space_member_groups）。 */
export async function deleteGroup(groupId: string): Promise<void> {
  const [deleted] = await db
    .delete(groups)
    .where(eq(groups.id, groupId))
    .returning({ id: groups.id });
  if (!deleted) throw new Error("NOT_FOUND");
}

export interface GroupMemberRow {
  userId: string;
  name: string;
  email: string;
  createdAt: Date;
}

/** 列出群組成員（姓名＋email＋加入時間），依加入時間排序。 */
export async function listGroupMembers(groupId: string): Promise<GroupMemberRow[]> {
  return db
    .select({
      userId: groupMembers.userId,
      name: users.name,
      email: users.email,
      createdAt: groupMembers.createdAt,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.createdAt));
}

/** 加入單一成員（Combobox 加人）；重複為 no-op。回傳是否實際新增。 */
export async function addGroupMember(groupId: string, userId: string): Promise<boolean> {
  const rows = await db
    .insert(groupMembers)
    .values({ groupId, userId })
    .onConflictDoNothing()
    .returning({ userId: groupMembers.userId });
  return rows.length > 0;
}

/** 移除單一成員；不存在為 no-op。 */
export async function removeGroupMember(groupId: string, userId: string): Promise<void> {
  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
}

/**
 * 從貼上的文字（CSV／換行／分號分隔）解析出正規化 email 清單：
 * 去除空白、轉小寫、去重、濾掉不含 `@` 的雜訊。
 */
export function parseEmails(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const email = raw.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    result.push(email);
  }
  return result;
}

export interface ImportEmailsResult {
  /** 實際新增（原本不在群組）的成員數 */
  added: number;
  /** 命中既有使用者但原本已是成員的數量 */
  alreadyMember: number;
  /** 找不到對應使用者的 email（原樣回報供 UI 呈現） */
  notFound: string[];
}

/**
 * CSV 批次匯入成員：以 email 比對現有使用者（不區分大小寫），命中者加入群組。
 * 找不到對應帳號的 email 回報於 notFound，不自動建立帳號（帳號建立走 F-ADMIN-01）。
 */
export async function importGroupMembersByEmails(
  groupId: string,
  emails: string[],
): Promise<ImportEmailsResult> {
  const normalized = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
  if (normalized.length === 0) return { added: 0, alreadyMember: 0, notFound: [] };

  const found = await db
    .select({ id: users.id, email: sql<string>`lower(${users.email})` })
    .from(users)
    .where(inArray(sql`lower(${users.email})`, normalized));
  const foundEmails = new Set(found.map((r) => r.email));
  const notFound = normalized.filter((e) => !foundEmails.has(e));

  let added = 0;
  if (found.length > 0) {
    const inserted = await db
      .insert(groupMembers)
      .values(found.map((r) => ({ groupId, userId: r.id })))
      .onConflictDoNothing()
      .returning({ userId: groupMembers.userId });
    added = inserted.length;
  }

  return { added, alreadyMember: found.length - added, notFound };
}
