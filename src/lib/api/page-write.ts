import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, spaces } from "@/lib/db/schema";
import { can, type Actor } from "@/lib/authz/permission";
import { markdownToDoc } from "@/lib/content/markdown-to-doc";
import { createPageInTx } from "@/lib/pages/create";
import { writePageContentTx } from "@/lib/pages/content-write";
import { VersionConflictError } from "@/lib/pages/errors";
import { acquireLock, getLockState, releaseLock } from "@/lib/pages/lock";
import { enqueueEmbedPage } from "@/lib/jobs/queue";
import { isEmbeddingConfigured } from "@/lib/llm";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/** 嵌入索引 enqueue（同 actions/page.ts 的 triggerEmbedPage）：fire-and-forget，絕不阻塞寫入。 */
async function triggerEmbedPage(pageId: string): Promise<void> {
  if (!isEmbeddingConfigured()) return;
  try {
    await enqueueEmbedPage(pageId);
  } catch (error) {
    logger.error({ err: error, pageId }, "enqueue embed-page 失敗（不阻塞 API 寫入）");
  }
}

/**
 * API 寫入管線（M4-09，issue #211）：MCP 工具與 REST v1 寫入端點共用的 lib 層。
 * 鐵律遵循：
 * - 內容一律經 markdownToDoc → createPageInTx / writePageContentTx（唯一儲存管線，
 *   三欄同交易同步＋版本快照），交易提交後才 enqueue embedding（架構鐵律 #5）。
 * - 權限一律經 can(user, "page.edit", …)，預設拒絕；封存空間唯讀由 can 內建處理。
 * - 尊重軟性編輯鎖（C1）：他人持有效鎖即拒絕，不搶鎖；寫入期間短暫持鎖後釋放。
 * - 不存在與無權一律回 NOT_FOUND（防枚舉，與唯讀端點一致）。
 * scope 檢查（write）由呼叫端薄殼（requireApiAuth / MCP 工具）負責。
 */

/** 單次 API 寫入的 Markdown 大小上限（請求安全防護，對齊匯入管線）。 */
export const API_WRITE_MARKDOWN_MAX_CHARS = 2 * 1024 * 1024;

export type ApiWriteFailure =
  | { ok: false; error: "NOT_FOUND" }
  | { ok: false; error: "LOCKED"; lockedByName: string | null }
  | { ok: false; error: "CONFLICT" };

export interface ApiPageRef {
  id: string;
  slug: string;
  title: string;
  spaceSlug: string;
  versionNo: number;
}

export type ApiWriteResult = { ok: true; page: ApiPageRef } | ApiWriteFailure;

export interface ApiCreatePageInput {
  spaceId: string;
  /** 父節點；null＝根層 */
  parentId?: string | null;
  title: string;
  markdown: string;
}

/** 建立頁面並寫入 Markdown 內容（同一交易：建節點＋三欄同步＋版本快照）。 */
export async function apiCreatePage(user: Actor, input: ApiCreatePageInput): Promise<ApiWriteResult> {
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, input.spaceId) });
  if (!space || space.deletedAt) return { ok: false, error: "NOT_FOUND" };
  if (!(await can(user, "page.edit", { type: "page", spaceId: space.id }))) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (input.parentId) {
    const parent = await db.query.pages.findFirst({ where: eq(pages.id, input.parentId) });
    if (!parent || parent.deletedAt || parent.spaceId !== space.id) {
      return { ok: false, error: "NOT_FOUND" };
    }
  }

  const doc = markdownToDoc(input.markdown);
  const { page, versionNo } = await db.transaction(async (tx) => {
    const created = await createPageInTx(tx, {
      spaceId: space.id,
      parentId: input.parentId ?? null,
      title: input.title,
      userId: user.id,
    });
    const v = await writePageContentTx(tx, {
      pageId: created.id,
      pageTitle: created.title,
      expectedVersionNo: created.currentVersionNo,
      content: doc,
      userId: user.id,
    });
    return { page: created, versionNo: v };
  });

  // 三欄同交易提交後才 enqueue 嵌入索引（架構鐵律 #5）
  await triggerEmbedPage(page.id);
  logger.info({ userId: user.id, pageId: page.id, spaceId: space.id }, "page created via api");
  await writeAudit({
    actorId: user.id,
    action: "page.api_create",
    targetType: "page",
    targetId: page.id,
    metadata: { spaceId: space.id, title: page.title, via: "api" },
    ip: null,
  });

  return {
    ok: true,
    page: { id: page.id, slug: page.slug, title: page.title, spaceSlug: space.slug, versionNo },
  };
}

export interface ApiUpdatePageInput {
  pageId: string;
  markdown: string;
}

/** 以 Markdown 全量更新頁面內容（重用唯一儲存管線；他人持鎖拒絕）。 */
export async function apiUpdatePage(user: Actor, input: ApiUpdatePageInput): Promise<ApiWriteResult> {
  const page = await db.query.pages.findFirst({ where: eq(pages.id, input.pageId) });
  // 群組／外部連結節點無內文（C-11），視同不存在
  if (!page || page.deletedAt || page.kind !== "page") return { ok: false, error: "NOT_FOUND" };
  if (!(await can(user, "page.edit", { type: "page", spaceId: page.spaceId }))) {
    return { ok: false, error: "NOT_FOUND" };
  }

  // C1 軟性編輯鎖：他人持有效鎖 → 拒絕（不搶鎖）；acquireLock 對過期鎖與自己持鎖冪等。
  // 呼叫前已是自己持鎖（本人同時在編輯器內）時，寫完不得釋放——鎖屬於編輯器 session。
  const before = await getLockState(page.id, user.id);
  const acquired = await acquireLock(page.id, user.id);
  if (!acquired) {
    const lock = await getLockState(page.id, user.id);
    return { ok: false, error: "LOCKED", lockedByName: lock.lockedByName };
  }
  const shouldRelease = !before.lockedByMe;

  const doc = markdownToDoc(input.markdown);
  let versionNo: number;
  try {
    versionNo = await db.transaction(async (tx) => {
      // 於交易內讀最新版本號作為樂觀鎖基準（API 呼叫端不追蹤版本）
      const fresh = await tx.query.pages.findFirst({ where: eq(pages.id, page.id) });
      if (!fresh || fresh.deletedAt) throw new VersionConflictError(0);
      return writePageContentTx(tx, {
        pageId: page.id,
        pageTitle: fresh.title,
        expectedVersionNo: fresh.currentVersionNo,
        content: doc,
        userId: user.id,
      });
    });
  } catch (error) {
    if (error instanceof VersionConflictError) return { ok: false, error: "CONFLICT" };
    throw error;
  } finally {
    if (shouldRelease) await releaseLock(page.id, user.id);
  }

  await triggerEmbedPage(page.id);
  logger.info({ userId: user.id, pageId: page.id, versionNo }, "page updated via api");
  await writeAudit({
    actorId: user.id,
    action: "page.api_update",
    targetType: "page",
    targetId: page.id,
    metadata: { spaceId: page.spaceId, versionNo, via: "api" },
    ip: null,
  });

  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  return {
    ok: true,
    page: {
      id: page.id,
      slug: page.slug,
      title: page.title,
      spaceSlug: space?.slug ?? "",
      versionNo,
    },
  };
}
