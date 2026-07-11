import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, notifications, pages, spaces } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

/**
 * 站內通知資料層（K-02，F-NOTIF-01）。
 *
 * - `notify` 為唯一寫入入口：**失敗不擲出**（比照 audit）——通知寫入失敗不得中斷
 *   主流程（例如張貼回覆仍須成功），僅記 warn 供監控。
 * - 讀取一律以 `userId` 收斂（使用者只能看自己的通知）；「標為已讀」同樣以 userId 過濾，
 *   不接受跨使用者操作。權限層面無需額外 authz：通知天生綁定 user_id。
 * - `payload` 至少含 `url`（點擊直達），其餘欄位依 type 而定。
 */

/** 已知通知種類。新增事件時擴充此聯集並在 UI 對應顯示文案。 */
export const NOTIFICATION_TYPES = ["comment_reply"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** 通知 payload：跨 server→client 邊界的顯示與跳轉脈絡（至少含 url）。 */
export interface NotificationPayload {
  /** 點擊直達目標（站內相對路徑，如 /s/eng/onboarding） */
  url: string;
  /** 觸發者顯示名稱 */
  actorName?: string;
  /** 相關頁面標題（顯示用） */
  pageTitle?: string;
  /** 內容摘要（如回覆前 N 字） */
  excerpt?: string;
}

/** 序列化後的通知檢視物件（時間為 ISO 字串，安全跨 server→client）。 */
export interface NotificationView {
  id: string;
  type: string;
  payload: NotificationPayload;
  /** 已讀時間 ISO；null＝未讀 */
  readAt: string | null;
  createdAt: string;
}

/** 收件匣預設抓取上限（鈴鐺 Popover 只需近期數則）。 */
const DEFAULT_LIMIT = 20;
/** 回覆摘要保留字數（避免 payload 塞入整段內文）。 */
const EXCERPT_MAX = 140;

/**
 * 寫入一筆通知（唯一寫入入口）。**失敗不擲出**：僅記 warn，不中斷主流程。
 */
export async function notify(
  userId: string,
  type: NotificationType,
  payload: NotificationPayload,
): Promise<void> {
  try {
    await db.insert(notifications).values({ userId, type, payload });
  } catch (error) {
    logger.warn({ error, type, userId }, "notify failed");
  }
}

/** 列出使用者近期通知（依建立時間新→舊，含已讀）。 */
export async function listNotifications(
  userId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<NotificationView[]> {
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      payload: notifications.payload,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    payload: normalizePayload(row.payload),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** 未讀通知數（鈴鐺徽章）。 */
export async function countUnread(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

/** 將該使用者全部未讀標為已讀（只影響本人；已讀者不動）。 */
export async function markAllRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

/**
 * 留言回覆事件掛點（K-02）：通知「討論串原作者」有人回覆。
 * - `topLevelCommentId` 為頂層留言 id；原作者＝該頂層留言的 author。
 * - 略過：原作者帳號已刪（authorId null）、或回覆者即原作者（不通知自己）。
 * - 內部 try/catch 包覆全部查詢：任何失敗都不得中斷張貼回覆的主流程。
 */
export async function notifyCommentReply(input: {
  topLevelCommentId: string;
  replierId: string;
  replierName: string;
  replyBody: string;
}): Promise<void> {
  try {
    const [target] = await db
      .select({
        recipientId: comments.authorId,
        pageSlug: pages.slug,
        pageTitle: pages.title,
        spaceSlug: spaces.slug,
      })
      .from(comments)
      .innerJoin(pages, eq(comments.pageId, pages.id))
      .innerJoin(spaces, eq(pages.spaceId, spaces.id))
      .where(eq(comments.id, input.topLevelCommentId))
      .limit(1);

    // 找不到、原作者已刪、或回覆者即原作者 → 不通知
    if (!target?.recipientId || target.recipientId === input.replierId) return;

    await notify(target.recipientId, "comment_reply", {
      url: `/s/${target.spaceSlug}/${target.pageSlug}`,
      actorName: input.replierName,
      pageTitle: target.pageTitle,
      excerpt: input.replyBody.slice(0, EXCERPT_MAX),
    });
  } catch (error) {
    logger.warn({ error, topLevelCommentId: input.topLevelCommentId }, "notifyCommentReply failed");
  }
}

/** jsonb payload 容錯正規化：確保 url 為字串，其餘欄位存在才帶入。 */
function normalizePayload(raw: unknown): NotificationPayload {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    url: str(obj.url) ?? "/",
    actorName: str(obj.actorName),
    pageTitle: str(obj.pageTitle),
    excerpt: str(obj.excerpt),
  };
}
