import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, spaces } from "@/lib/db/schema";
import { can, type Actor } from "@/lib/authz/permission";
import { markdownToDoc } from "@/lib/content/markdown-to-doc";
import { createPageInTx } from "@/lib/pages/create";
import { writePageContentTx } from "@/lib/pages/content-write";
import { PageMoveCycleError, VersionConflictError } from "@/lib/pages/errors";
import { movePageNode } from "@/lib/pages/move";
import { movePageSubtreeToSpace } from "@/lib/pages/cross-space";
import { acquireLock, getLockState, releaseLock } from "@/lib/pages/lock";
import { renamePageTx } from "@/lib/pages/rename";
import { reembedIndexedPages, triggerEmbedPage } from "@/lib/jobs/queue";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * API 寫入管線（M4-09，issue #211）：MCP 工具與 REST v1 寫入端點共用的 lib 層。
 * 鐵律遵循：
 * - 內容一律經 markdownToDoc → createPageInTx / writePageContentTx（唯一儲存管線，
 *   三欄同交易同步＋版本快照），交易提交後才 enqueue embedding（架構鐵律 #5）。
 * - 非互動寫入停用快照合併窗（snapshotMergeMs: 0）：每次 API 寫入必留獨立版本，
 *   不覆寫使用者 5 分鐘內的手動存檔快照（update_page 對呼叫端承諾「可還原」）。
 * - 權限一律經 can(user, "page.edit", …)，預設拒絕；封存空間唯讀由 can 內建處理。
 * - 尊重軟性編輯鎖（C1）：他人持有效鎖即拒絕，不搶鎖；寫入期間短暫持鎖後釋放。
 * - 不存在與無權一律回 NOT_FOUND（防枚舉，與唯讀端點一致）。
 * scope 檢查（write）由呼叫端薄殼（requireApiAuth / MCP 工具 gate）負責。
 */

/** 單次 API 寫入的 Markdown 大小上限（請求安全防護，對齊匯入管線）。 */
export const API_WRITE_MARKDOWN_MAX_CHARS = 2 * 1024 * 1024;

/** 頁面標題長度上限（對齊 web schema 的 max(200)；MCP 與 REST 薄殼共用，避免各寫一份漂移）。 */
export const API_PAGE_TITLE_MAX_CHARS = 200;

export type ApiWriteFailure =
  | { ok: false; error: "NOT_FOUND" }
  | { ok: false; error: "LOCKED"; lockedByName: string | null }
  | { ok: false; error: "CONFLICT"; currentVersionNo: number };

export interface ApiPageRef {
  id: string;
  slug: string;
  title: string;
  spaceSlug: string;
  versionNo: number;
}

export type ApiWriteResult = { ok: true; page: ApiPageRef } | ApiWriteFailure;

/** 交易內發現頁面已被並行刪除（語意＝NOT_FOUND，非版本衝突）。 */
class PageGoneError extends Error {}

export interface ApiCreatePageInput {
  /** 目標空間：id（MCP）或 slug（REST）擇一。 */
  spaceId?: string;
  spaceSlug?: string;
  /** 父節點；null＝根層 */
  parentId?: string | null;
  title: string;
  markdown: string;
}

/** 建立頁面並寫入 Markdown 內容（同一交易：建節點＋三欄同步＋版本快照）。 */
export async function apiCreatePage(user: Actor, input: ApiCreatePageInput): Promise<ApiWriteResult> {
  // 空間解析與存在性/權限判定的唯一位置（REST 薄殼不另行查驗，避免雙份判定漂移）
  const space = input.spaceId
    ? await db.query.spaces.findFirst({ where: eq(spaces.id, input.spaceId) })
    : input.spaceSlug
      ? await db.query.spaces.findFirst({ where: eq(spaces.slug, input.spaceSlug) })
      : undefined;
  if (!space || space.deletedAt) return { ok: false, error: "NOT_FOUND" };
  if (!(await can(user, "page.edit", { type: "page", spaceId: space.id }))) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (input.parentId) {
    const parent = await db.query.pages.findFirst({ where: eq(pages.id, input.parentId) });
    // external_link 為葉節點不可作父（C-11）；一併在此擋下，避免交易內 throw 洩漏為 500
    if (!parent || parent.deletedAt || parent.spaceId !== space.id || parent.kind === "external_link") {
      return { ok: false, error: "NOT_FOUND" };
    }
  }

  const doc = markdownToDoc(input.markdown);
  let page: typeof pages.$inferSelect;
  let versionNo: number;
  try {
    ({ page, versionNo } = await db.transaction(async (tx) => {
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
        snapshotMergeMs: 0,
      });
      return { page: created, versionNo: v };
    }));
  } catch (error) {
    // 前置檢查後父節點才變成 external_link 的競態：交易內防線擲出 → 對呼叫端仍是 NOT_FOUND
    if (error instanceof Error && error.message === "EXTERNAL_LINK_NO_CHILDREN") {
      return { ok: false, error: "NOT_FOUND" };
    }
    throw error;
  }

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
  /** 新內容（Markdown 全量取代）；省略＝不動內容。與 title 至少提供一項（呼叫端薄殼驗證）。 */
  markdown?: string;
  /** 新標題；省略＝不動標題。改名沿用 web renamePage 規則：slug 重算＋舊 slug 進 301 歷史。 */
  title?: string;
  /**
   * 樂觀鎖（M4-13）：呼叫端已知的版本號，不符即回 CONFLICT（含目前版本號供重讀）。
   * 省略＝以交易內最新版本為基準（#211 原行為）。
   */
  expectedVersion?: number;
}

/** 部分更新頁面（標題／內容擇一或皆有；重用唯一儲存管線；他人持鎖拒絕）。 */
export async function apiUpdatePage(user: Actor, input: ApiUpdatePageInput): Promise<ApiWriteResult> {
  if (input.markdown === undefined && input.title === undefined) {
    // 呼叫端薄殼已擋；此為程式錯誤而非使用者輸入
    throw new Error("apiUpdatePage: markdown 與 title 至少需提供一項");
  }
  const page = await db.query.pages.findFirst({ where: eq(pages.id, input.pageId) });
  // 群組／外部連結節點無內文（C-11），視同不存在
  if (!page || page.deletedAt || page.kind !== "page") return { ok: false, error: "NOT_FOUND" };
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  if (!space || space.deletedAt) return { ok: false, error: "NOT_FOUND" };
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

  const doc = input.markdown !== undefined ? markdownToDoc(input.markdown) : null;
  let result: { versionNo: number; title: string; slug: string; titleChanged: boolean };
  try {
    result = await db.transaction(async (tx) => {
      const fresh = await tx.query.pages.findFirst({ where: eq(pages.id, page.id) });
      if (!fresh || fresh.deletedAt) throw new PageGoneError();
      // 呼叫端帶 expectedVersion 時先行比對（不符早退）；實際防線是下方兩個
      // 原子 WHERE：renamePageTx 的 guardVersionNo 與 writePageContentTx 的樂觀鎖，
      // 皆以交易內讀到的 baseVersion 為基準，堵住「比對後、更新前」的並發時窗。
      if (input.expectedVersion !== undefined && fresh.currentVersionNo !== input.expectedVersion) {
        throw new VersionConflictError(fresh.currentVersionNo);
      }
      const baseVersion = fresh.currentVersionNo;

      let title = fresh.title;
      let slug = fresh.slug;
      const titleChanged = input.title !== undefined && input.title !== fresh.title;
      if (titleChanged) {
        title = input.title!;
        const renamed = await renamePageTx(tx, {
          page: { id: fresh.id, spaceId: fresh.spaceId, slug: fresh.slug },
          title,
          userId: user.id,
          guardVersionNo: baseVersion,
        });
        if (!renamed) {
          const now = await tx.query.pages.findFirst({ where: eq(pages.id, fresh.id) });
          throw new VersionConflictError(now?.currentVersionNo ?? 0);
        }
        slug = renamed.slug;
      }

      // title-only 更新不動內容也不遞增版本（renamePageTx 語意，與 web renamePage 一致）
      let v = baseVersion;
      if (doc) {
        v = await writePageContentTx(tx, {
          pageId: fresh.id,
          pageTitle: title,
          expectedVersionNo: baseVersion,
          content: doc,
          userId: user.id,
          snapshotMergeMs: 0,
        });
      }
      return { versionNo: v, title, slug, titleChanged };
    });
  } catch (error) {
    if (error instanceof PageGoneError) return { ok: false, error: "NOT_FOUND" };
    if (error instanceof VersionConflictError) {
      return { ok: false, error: "CONFLICT", currentVersionNo: error.currentVersionNo };
    }
    throw error;
  } finally {
    if (shouldRelease) await releaseLock(page.id, user.id);
  }

  const contentChanged = doc !== null;
  // 標題也在 embedding chunk 內（chunkMarkdown(title, …)），故改名同樣重嵌；
  // no-op（title 與現值相同且無內容）不 enqueue，避免冪等重送打爆 embedding worker
  if (contentChanged || result.titleChanged) await triggerEmbedPage(page.id);
  logger.info({ userId: user.id, pageId: page.id, versionNo: result.versionNo }, "page updated via api");
  await writeAudit({
    actorId: user.id,
    action: "page.api_update",
    targetType: "page",
    targetId: page.id,
    metadata: {
      spaceId: page.spaceId,
      versionNo: result.versionNo,
      via: "api",
      titleChanged: result.titleChanged,
      contentChanged,
    },
    ip: null,
  });

  return {
    ok: true,
    page: {
      id: page.id,
      slug: result.slug,
      title: result.title,
      spaceSlug: space.slug,
      versionNo: result.versionNo,
    },
  };
}

export interface ApiMovePageInput {
  pageId: string;
  /** 目的地空間（跨空間搬移；省略＝同空間 reparent）。 */
  targetSpaceId?: string;
  /** 同空間搬移的新父節點（null＝根層；接該層末尾）。跨空間搬移不支援（一律掛目標根層，與 web 一致）。 */
  newParentId?: string | null;
}

export type ApiMoveResult =
  | {
      ok: true;
      page: { id: string; slug: string; spaceSlug: string; parentId: string | null };
      /** 受影響頁數（跨空間＝整支子樹；同空間＝1） */
      movedCount: number;
    }
  | { ok: false; error: "NOT_FOUND" }
  | { ok: false; error: "CYCLE" }
  | { ok: false; error: "INVALID"; message: string };

/**
 * 搬移頁面（M4-14，issue #219）：MCP 工具與 REST v1 共用的 lib 層。
 * - 同空間 reparent：重用 movePageNode（循環防護 recursive CTE、fractional index 接末尾、
 *   external_link 不可作父）。
 * - 跨空間：重用 movePageSubtreeToSpace（子樹 space_id／slug 撞名重生成／附件歸屬同交易轉移，
 *   根頁掛目標根層——與 web movePageToSpace 相同語意），搬移後 best-effort 重嵌。
 * - 權限：來源與目標空間都需 can(user, "page.edit", …)；不存在/無權一律 NOT_FOUND 防枚舉。
 * - 搬移不動內容三欄位，無鎖與版本語意（與 web 拖曳/跨空間搬移一致，不檢查編輯鎖）。
 */
export async function apiMovePage(user: Actor, input: ApiMovePageInput): Promise<ApiMoveResult> {
  const page = await db.query.pages.findFirst({ where: eq(pages.id, input.pageId) });
  if (!page || page.deletedAt) return { ok: false, error: "NOT_FOUND" };
  if (!(await can(user, "page.edit", { type: "page", spaceId: page.spaceId }))) {
    return { ok: false, error: "NOT_FOUND" };
  }

  const crossSpace = input.targetSpaceId !== undefined;
  if (crossSpace) {
    if (input.targetSpaceId === page.spaceId) {
      return { ok: false, error: "INVALID", message: "targetSpaceId 與頁面現行空間相同；同空間搬移請改用 newParentId" };
    }
    if (input.newParentId != null) {
      return { ok: false, error: "INVALID", message: "跨空間搬移一律掛目標空間根層，不支援 newParentId" };
    }
    const target = await db.query.spaces.findFirst({ where: eq(spaces.id, input.targetSpaceId!) });
    if (!target || target.deletedAt) return { ok: false, error: "NOT_FOUND" };
    if (!(await can(user, "page.edit", { type: "page", spaceId: target.id }))) {
      return { ok: false, error: "NOT_FOUND" };
    }

    let rootSlug: string;
    let movedPageIds: string[];
    try {
      ({ rootSlug, movedPageIds } = await movePageSubtreeToSpace({
        pageId: page.id,
        targetSpaceId: target.id,
        movedBy: user.id,
      }));
    } catch (error) {
      if (error instanceof Error && (error.message === "NOT_FOUND" || error.message === "SAME_SPACE")) {
        return { ok: false, error: "NOT_FOUND" };
      }
      throw error;
    }

    await reembedIndexedPages(movedPageIds);
    logger.info(
      { userId: user.id, pageId: page.id, fromSpace: page.spaceId, toSpace: target.id },
      "page moved across spaces via api",
    );
    await writeAudit({
      actorId: user.id,
      action: "page.api_move",
      targetType: "page",
      targetId: page.id,
      metadata: {
        fromSpaceId: page.spaceId,
        toSpaceId: target.id,
        fromParentId: page.parentId,
        toParentId: null,
        movedCount: movedPageIds.length,
        via: "api",
      },
      ip: null,
    });
    return {
      ok: true,
      page: { id: page.id, slug: rootSlug, spaceSlug: target.slug, parentId: null },
      movedCount: movedPageIds.length,
    };
  }

  if (input.newParentId === undefined) {
    return { ok: false, error: "INVALID", message: "同空間搬移需提供 newParentId（null＝根層）；跨空間請提供 targetSpaceId" };
  }
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  if (!space || space.deletedAt) return { ok: false, error: "NOT_FOUND" };

  try {
    await movePageNode({
      pageId: page.id,
      newParentId: input.newParentId,
      movedBy: user.id,
    });
  } catch (error) {
    if (error instanceof PageMoveCycleError) return { ok: false, error: "CYCLE" };
    if (
      error instanceof Error &&
      (error.message === "NOT_FOUND" || error.message === "EXTERNAL_LINK_NO_CHILDREN")
    ) {
      return { ok: false, error: "NOT_FOUND" };
    }
    throw error;
  }

  logger.info(
    { userId: user.id, pageId: page.id, newParentId: input.newParentId },
    "page moved via api",
  );
  await writeAudit({
    actorId: user.id,
    action: "page.api_move",
    targetType: "page",
    targetId: page.id,
    metadata: {
      fromSpaceId: page.spaceId,
      toSpaceId: page.spaceId,
      fromParentId: page.parentId,
      toParentId: input.newParentId,
      movedCount: 1,
      via: "api",
    },
    ip: null,
  });
  return {
    ok: true,
    page: { id: page.id, slug: page.slug, spaceSlug: space.slug, parentId: input.newParentId },
    movedCount: 1,
  };
}
