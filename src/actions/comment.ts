"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { assertCan, can } from "@/lib/authz/permission";
import {
  getCommentWithSpace,
  insertComment,
  setCommentResolved,
  softDeleteComment,
  updateCommentBody,
  type CommentView,
} from "@/lib/comments/service";
import { logger } from "@/lib/logger";

/**
 * 頁面留言 Server Actions（K-01，架構鐵律 #6 薄殼）：
 * 驗 session → 驗權限（authz 唯一入口）→ 呼叫 lib/comments 資料層。
 * 留言／回覆／解決需 `page.comment`（commenter+）；刪除限本人或 space admin；編輯限本人。
 */

const bodySchema = z.string().trim().min(1, "留言不可為空").max(4000, "留言過長");

/** 讀取未刪除頁面並回傳其 spaceId；找不到即 NOT_FOUND。 */
async function requirePageSpace(pageId: string): Promise<string> {
  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), isNull(pages.deletedAt)),
  });
  if (!page) throw new Error("NOT_FOUND");
  return page.spaceId;
}

const addSchema = z.object({ pageId: z.uuid(), body: bodySchema });

/** 新增頂層留言（需 commenter+）。 */
export async function addComment(input: z.infer<typeof addSchema>): Promise<CommentView> {
  const data = addSchema.parse(input);
  const { user } = await requireSession();
  const spaceId = await requirePageSpace(data.pageId);
  await assertCan(user, "page.comment", { type: "page", spaceId });

  const created = await insertComment({
    pageId: data.pageId,
    parentCommentId: null,
    authorId: user.id,
    body: data.body,
  });
  logger.info({ userId: user.id, pageId: data.pageId, commentId: created.id }, "comment added");
  return created;
}

const replySchema = z.object({ parentCommentId: z.uuid(), body: bodySchema });

/** 回覆既有討論串（需 commenter+；回覆只掛在頂層留言下，v1 單層）。 */
export async function replyComment(input: z.infer<typeof replySchema>): Promise<CommentView> {
  const data = replySchema.parse(input);
  const { user } = await requireSession();
  const found = await getCommentWithSpace(data.parentCommentId);
  if (!found || found.comment.deletedAt) throw new Error("NOT_FOUND");
  await assertCan(user, "page.comment", { type: "page", spaceId: found.spaceId });
  // 回覆一律掛到頂層討論串（若對回覆再回覆，向上歸位到其父）。
  const parentId = found.comment.parentCommentId ?? found.comment.id;

  const created = await insertComment({
    pageId: found.comment.pageId,
    parentCommentId: parentId,
    authorId: user.id,
    body: data.body,
  });
  logger.info(
    { userId: user.id, pageId: found.comment.pageId, parentId, commentId: created.id },
    "comment reply added",
  );
  return created;
}

const resolveSchema = z.object({ commentId: z.uuid(), resolved: z.boolean() });

/** 標記解決／重新開啟討論串（需 commenter+；僅頂層留言）。 */
export async function resolveComment(input: z.infer<typeof resolveSchema>): Promise<void> {
  const data = resolveSchema.parse(input);
  const { user } = await requireSession();
  const found = await getCommentWithSpace(data.commentId);
  if (!found || found.comment.deletedAt) throw new Error("NOT_FOUND");
  if (found.comment.parentCommentId) throw new Error("NOT_A_THREAD");
  await assertCan(user, "page.comment", { type: "page", spaceId: found.spaceId });

  await setCommentResolved(data.commentId, data.resolved);
  logger.info(
    { userId: user.id, commentId: data.commentId, resolved: data.resolved },
    "comment resolve toggled",
  );
}

const editSchema = z.object({ commentId: z.uuid(), body: bodySchema });

/** 編輯留言（限本人）。 */
export async function editComment(input: z.infer<typeof editSchema>): Promise<void> {
  const data = editSchema.parse(input);
  const { user } = await requireSession();
  const found = await getCommentWithSpace(data.commentId);
  if (!found || found.comment.deletedAt) throw new Error("NOT_FOUND");
  // 仍要求對該 space 至少有留言權（避免降權後仍可改舊留言）。
  await assertCan(user, "page.comment", { type: "page", spaceId: found.spaceId });
  if (found.comment.authorId !== user.id) throw new Error("FORBIDDEN");

  await updateCommentBody(data.commentId, data.body);
  logger.info({ userId: user.id, commentId: data.commentId }, "comment edited");
}

const deleteSchema = z.object({ commentId: z.uuid() });

/** 刪除留言（軟刪；限本人或 space admin）。 */
export async function deleteComment(input: z.infer<typeof deleteSchema>): Promise<void> {
  const { commentId } = deleteSchema.parse(input);
  const { user } = await requireSession();
  const found = await getCommentWithSpace(commentId);
  if (!found || found.comment.deletedAt) throw new Error("NOT_FOUND");

  const isAuthor = found.comment.authorId === user.id;
  const isSpaceAdmin = await can(user, "space.manage", { type: "space", spaceId: found.spaceId });
  if (!isAuthor && !isSpaceAdmin) throw new Error("FORBIDDEN");

  await softDeleteComment(commentId);
  logger.info({ userId: user.id, commentId, isSpaceAdmin }, "comment deleted");
}
