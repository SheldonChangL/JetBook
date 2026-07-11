import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, pages, users, type Comment } from "@/lib/db/schema";

/**
 * 頁面留言資料層（K-01，F-COLLAB-02）。純資料存取與討論串組裝：
 * 權限判斷（authz `page.comment` / 本人或 space admin）由 action 薄殼負責，
 * 本模組不散寫權限邏輯（架構鐵律 #1/#6）。
 */

/** 序列化後的留言檢視物件（跨 server→client 邊界安全：時間為 ISO 字串）。 */
export interface CommentView {
  id: string;
  authorId: string | null;
  /** 作者姓名；帳號刪除或墓碑留言為 null */
  authorName: string | null;
  /** 內文；墓碑（已刪但保留脈絡）為空字串，deleted=true */
  body: string;
  deleted: boolean;
  /** 解決時間 ISO（僅頂層留言）；null＝未解決 */
  resolvedAt: string | null;
  createdAt: string;
  /** 回覆（僅頂層留言帶此欄，依時間正序） */
  replies: CommentView[];
}

/** 留言連同所屬頁面的 spaceId（供 action 薄殼做 authz）。 */
export interface CommentWithSpace {
  comment: Comment;
  spaceId: string;
}

interface CommentRow {
  id: string;
  pageId: string;
  parentCommentId: string | null;
  authorId: string | null;
  authorName: string | null;
  body: string;
  resolvedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

function toReplyView(row: CommentRow): CommentView {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    authorId: deleted ? null : row.authorId,
    authorName: deleted ? null : row.authorName,
    body: deleted ? "" : row.body,
    deleted,
    resolvedAt: null,
    createdAt: row.createdAt.toISOString(),
    replies: [],
  };
}

/**
 * 列出某頁全部討論串（頂層留言，依建立時間正序；回覆巢狀於下）。
 * - 軟刪的回覆直接略過；軟刪但仍有可見回覆的頂層留言以墓碑呈現（避免回覆變孤兒）。
 * - 無可見回覆的軟刪頂層留言則整串隱藏。
 */
export async function listPageComments(pageId: string): Promise<CommentView[]> {
  const rows: CommentRow[] = await db
    .select({
      id: comments.id,
      pageId: comments.pageId,
      parentCommentId: comments.parentCommentId,
      authorId: comments.authorId,
      authorName: users.name,
      body: comments.body,
      resolvedAt: comments.resolvedAt,
      createdAt: comments.createdAt,
      deletedAt: comments.deletedAt,
    })
    .from(comments)
    .leftJoin(users, eq(comments.authorId, users.id))
    .where(eq(comments.pageId, pageId))
    .orderBy(asc(comments.createdAt));

  const repliesByParent = new Map<string, CommentRow[]>();
  const topLevel: CommentRow[] = [];
  for (const row of rows) {
    if (row.parentCommentId) {
      const list = repliesByParent.get(row.parentCommentId) ?? [];
      list.push(row);
      repliesByParent.set(row.parentCommentId, list);
    } else {
      topLevel.push(row);
    }
  }

  const threads: CommentView[] = [];
  for (const parent of topLevel) {
    const replies = (repliesByParent.get(parent.id) ?? [])
      .filter((r) => r.deletedAt === null)
      .map(toReplyView);
    // 頂層已軟刪且無可見回覆 → 整串隱藏
    if (parent.deletedAt !== null && replies.length === 0) continue;

    const parentDeleted = parent.deletedAt !== null;
    threads.push({
      id: parent.id,
      authorId: parentDeleted ? null : parent.authorId,
      authorName: parentDeleted ? null : parent.authorName,
      body: parentDeleted ? "" : parent.body,
      deleted: parentDeleted,
      resolvedAt: parent.resolvedAt ? parent.resolvedAt.toISOString() : null,
      createdAt: parent.createdAt.toISOString(),
      replies,
    });
  }
  return threads;
}

/** 取單一留言連同 spaceId（找不到或所屬頁面已刪回 null）。 */
export async function getCommentWithSpace(commentId: string): Promise<CommentWithSpace | null> {
  const row = await db
    .select({ comment: comments, spaceId: pages.spaceId, pageDeletedAt: pages.deletedAt })
    .from(comments)
    .innerJoin(pages, eq(comments.pageId, pages.id))
    .where(eq(comments.id, commentId))
    .limit(1);
  const found = row[0];
  if (!found || found.pageDeletedAt !== null) return null;
  return { comment: found.comment, spaceId: found.spaceId };
}

/** 建立留言（頂層或回覆），回傳序列化檢視物件（含作者名，供樂觀更新落地）。 */
export async function insertComment(input: {
  pageId: string;
  parentCommentId: string | null;
  authorId: string;
  body: string;
}): Promise<CommentView> {
  const [created] = await db
    .insert(comments)
    .values({
      pageId: input.pageId,
      parentCommentId: input.parentCommentId,
      authorId: input.authorId,
      body: input.body,
    })
    .returning();
  if (!created) throw new Error("comment 建立失敗");
  const author = await db.query.users.findFirst({ where: eq(users.id, input.authorId) });
  return {
    id: created.id,
    authorId: created.authorId,
    authorName: author?.name ?? null,
    body: created.body,
    deleted: false,
    resolvedAt: null,
    createdAt: created.createdAt.toISOString(),
    replies: [],
  };
}

/** 設定頂層留言解決狀態（resolved=true→now、false→null）。 */
export async function setCommentResolved(commentId: string, resolved: boolean): Promise<void> {
  await db
    .update(comments)
    .set({ resolvedAt: resolved ? new Date() : null })
    .where(eq(comments.id, commentId));
}

/** 更新留言內文（限本人，權限於 action 判斷）。 */
export async function updateCommentBody(commentId: string, body: string): Promise<void> {
  await db.update(comments).set({ body }).where(eq(comments.id, commentId));
}

/** 軟刪除留言（保留討論串脈絡）。 */
export async function softDeleteComment(commentId: string): Promise<void> {
  await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
}
