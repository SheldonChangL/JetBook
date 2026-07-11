"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth/current";
import { assertCan } from "@/lib/authz/permission";
import { searchMentionableUsers, type MentionableUser } from "@/lib/mentions/mentionable";
import { searchLinkablePages, type LinkablePage } from "@/lib/pages/link-search";

/**
 * 編輯器 @mention / 頁面連結 suggestion 的候選查詢薄殼（D-11，架構鐵律 #6）：
 * 驗 session → 驗 page.edit（插入僅發生於編輯情境）→ 呼叫 lib 層查詢。
 * 商業邏輯（可讀性過濾、SQL 層權限收斂）全在 lib，不散寫於此。
 */

const searchSchema = z.object({
  spaceId: z.uuid(),
  query: z.string().max(100).default(""),
});

/** @mention 候選：可對該 Space 讀取的在職成員（依姓名/email 前綴收斂）。 */
export async function searchMentionMembers(
  input: z.input<typeof searchSchema>,
): Promise<MentionableUser[]> {
  const { spaceId, query } = searchSchema.parse(input);
  const { user } = await requireSession();
  await assertCan(user, "page.edit", { type: "page", spaceId });
  return searchMentionableUsers(spaceId, query);
}

/** 頁面連結候選：使用者可讀、當前 Space 內、標題命中的頁面。 */
export async function searchPageLinkTargets(
  input: z.input<typeof searchSchema>,
): Promise<LinkablePage[]> {
  const { spaceId, query } = searchSchema.parse(input);
  const { user } = await requireSession();
  await assertCan(user, "page.edit", { type: "page", spaceId });
  return searchLinkablePages(user, spaceId, query);
}
