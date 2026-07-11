import "server-only";
import { and, desc, eq, exists } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConversations, aiMessages } from "@/lib/db/schema";
import type {
  AiConversationDetail,
  AiConversationMessage,
  AiConversationSummary,
  AiSource,
} from "./types";

/**
 * AI 對話與訊息的資料存取層（I-07，F-AI-07）。
 *
 * 對話與訊息為「使用者私有資源」：讀取一律以擁有者過濾（`where user_id = 自己`），
 * 非 space/page 的 RBAC（不經 authz `can()`），與 notifications／page_visits 同類。
 * 商業邏輯（續談編排、query rewrite、標題生成）在 `conversation-chat.ts`；本檔只做讀寫。
 */

/** 續談時餵給 LLM 的一則歷史訊息（role + 純文字內容）。 */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** 建立新對話（暫定標題；標題稍後由 light tier 生成後更新）。回傳新對話 id。 */
export async function createConversation(input: {
  userId: string;
  spaceId?: string | null;
  title: string;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(aiConversations)
    .values({
      userId: input.userId,
      spaceId: input.spaceId ?? null,
      title: input.title,
    })
    .returning({ id: aiConversations.id });
  if (!row) throw new Error("createConversation failed");
  return row;
}

/**
 * 取得對話（僅擁有者可讀）。非本人或不存在一律回 null（不區分，避免存在性洩漏）。
 * 回傳含 spaceId 供續談沿用同一檢索範圍。
 */
export async function getConversation(
  userId: string,
  conversationId: string,
): Promise<{ id: string; title: string; spaceId: string | null } | null> {
  const [row] = await db
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      spaceId: aiConversations.spaceId,
    })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * 列出本人的對話（歷史下拉；僅含至少一則訊息者，隱藏中斷未留言的空對話）。
 * 依最近更新排序，預設上限 50。
 */
export async function listConversations(
  userId: string,
  limit = 50,
): Promise<AiConversationSummary[]> {
  const rows = await db
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      updatedAt: aiConversations.updatedAt,
    })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.userId, userId),
        exists(
          db
            .select({ one: aiMessages.id })
            .from(aiMessages)
            .where(eq(aiMessages.conversationId, aiConversations.id)),
        ),
      ),
    )
    .orderBy(desc(aiConversations.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }));
}

/**
 * 載入對話完整歷史（僅擁有者）。非本人或不存在回 null。
 * 訊息依時間序（成對 user/assistant），assistant 訊息還原 sources 快照供來源卡片重繪。
 */
export async function getConversationMessages(
  userId: string,
  conversationId: string,
): Promise<AiConversationDetail | null> {
  const conv = await getConversation(userId, conversationId);
  if (!conv) return null;
  const rows = await messageRows(conversationId);
  const messages: AiConversationMessage[] = rows.map((r) => ({
    id: r.id,
    role: r.role,
    text: r.content,
    sources: r.sources ?? [],
  }));
  return { id: conv.id, title: conv.title, messages };
}

/**
 * 續談用歷史（餵 LLM 的 role/content 序列，時間序）。呼叫端須先以 getConversation 驗擁有者。
 * 只取純文字（user＝原始提問、assistant＝回答文字），不含檢索 context，避免脈絡爆量。
 */
export async function loadHistory(conversationId: string): Promise<HistoryMessage[]> {
  const rows = await messageRows(conversationId);
  return rows.map((r) => ({ role: r.role, content: r.content }));
}

/** 追加一則訊息（user 或 assistant）。sources 僅 assistant 帶檢索快照，user 為 null。 */
export async function appendMessage(input: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  sources?: AiSource[] | null;
}): Promise<void> {
  await db.insert(aiMessages).values({
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    sources: input.sources ?? null,
  });
}

/** 更新對話 updated_at（有新訊息後，供歷史列表依最近活動排序）。 */
export async function touchConversation(conversationId: string): Promise<void> {
  await db
    .update(aiConversations)
    .set({ updatedAt: new Date() })
    .where(eq(aiConversations.id, conversationId));
}

/** 更新對話標題（首問經 light tier 生成後回填）。 */
export async function updateConversationTitle(
  conversationId: string,
  title: string,
): Promise<void> {
  await db
    .update(aiConversations)
    .set({ title })
    .where(eq(aiConversations.id, conversationId));
}

/** 對話所有訊息（時間序；id tie-break 保穩定）。 */
async function messageRows(conversationId: string) {
  return db
    .select({
      id: aiMessages.id,
      role: aiMessages.role,
      content: aiMessages.content,
      sources: aiMessages.sources,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(aiMessages.createdAt, aiMessages.id);
}
