import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Db } from "@/lib/db";
import { attachments, pages } from "@/lib/db/schema";
import { EMPTY_DOC, type ProseMirrorDoc } from "@/lib/content/types";
import { createPageInTx, lastChildPosition } from "@/lib/pages/create";
import { writePageContentTx } from "@/lib/pages/content-write";
import { positionBetween } from "@/lib/pages/position";
import { uniquePageSlug } from "@/lib/pages/slug";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** 子樹節點原始資料列（跨 space 搬移／複製共用）。 */
interface SubtreeRow {
  id: string;
  spaceId: string;
  parentId: string | null;
  slug: string;
  title: string;
  icon: string | null;
  content: ProseMirrorDoc | null;
  position: string;
}

/**
 * 以 recursive CTE 取整支子樹（未刪除），依深度、position 排序——
 * 保證父節點排在子節點之前（複製時據此建立父子對應），同層依 fractional index。
 * 軟刪除節點（deleted_at 非空）不納入：已刪除分支留在原 space 回收桶，不隨移動／複製走。
 */
async function fetchSubtree(tx: Tx, rootId: string): Promise<SubtreeRow[]> {
  const result = await tx.execute<{
    id: string;
    space_id: string;
    parent_id: string | null;
    slug: string;
    title: string;
    icon: string | null;
    content: ProseMirrorDoc | null;
    position: string;
  }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id, space_id, parent_id, slug, title, icon, content, position, 0 AS depth
      FROM ${pages} WHERE id = ${rootId} AND deleted_at IS NULL
      UNION ALL
      SELECT p.id, p.space_id, p.parent_id, p.slug, p.title, p.icon, p.content, p.position, s.depth + 1
      FROM ${pages} p JOIN subtree s ON p.parent_id = s.id
      WHERE p.deleted_at IS NULL
    )
    SELECT id, space_id, parent_id, slug, title, icon, content, position
    FROM subtree
    ORDER BY depth, position COLLATE "C"
  `);
  return result.rows.map((r) => ({
    id: r.id,
    spaceId: r.space_id,
    parentId: r.parent_id,
    slug: r.slug,
    title: r.title,
    icon: r.icon,
    content: r.content,
    position: r.position,
  }));
}

/** 目標 space 內取一個可用 slug：現行 slug 未被佔用即沿用，否則由標題重生成唯一 slug。 */
async function freeSlugInTarget(
  tx: Tx,
  targetSpaceId: string,
  currentSlug: string,
  title: string,
): Promise<string> {
  const clash = await tx.query.pages.findFirst({
    where: and(eq(pages.spaceId, targetSpaceId), eq(pages.slug, currentSlug)),
  });
  if (!clash) return currentSlug;
  return uniquePageSlug(targetSpaceId, title, { client: tx });
}

export interface MovePageToSpaceInput {
  /** 被搬移子樹的根頁面 */
  pageId: string;
  /** 目的地 space（須與來源不同；權限由呼叫端薄殼先驗） */
  targetSpaceId: string;
  /** 操作者（寫入 updated_by） */
  movedBy: string;
}

export interface MovePageToSpaceResult {
  /** 搬移後的根頁面現行 slug（可能因目標 space 撞名而重生成） */
  rootSlug: string;
  /** 受影響（隨子樹搬移）的全部頁面 id */
  movedPageIds: string[];
}

/**
 * 跨 Space 搬移整支子樹（C-10，F-PAGE-05）：於單一交易內
 * 1. recursive 更新子樹每頁 `space_id` 至目的地；
 * 2. 目標 space 內 slug 撞名時重生成（沿用現行 slug 為主，衝突才改）；
 * 3. 根頁 `parent_id` 收為 null（原父留在來源 space，不可跨 space 引用）並取得目標根層末尾 position；
 * 4. 子樹頁面所屬附件 `attachments.space_id` 同步轉移（G6）——附件權限即刻跟隨目的地 space。
 *
 * 版本歷史（page_versions FK page_id）與 pageId 錨定的內部連結（D-11 link-resolve 依現行
 * space slug 重算）不受影響，仍有效。內容三欄位不變故不在此重寫（搬移不改內容）。
 * 權限與 session 由呼叫端薄殼（來源 page.edit + 目標 page.edit）先驗，本函式只負責 DB 管線。
 */
export async function movePageSubtreeToSpace(
  input: MovePageToSpaceInput,
): Promise<MovePageToSpaceResult> {
  const { pageId, targetSpaceId, movedBy } = input;

  return db.transaction(async (tx) => {
    const rows = await fetchSubtree(tx, pageId);
    if (rows.length === 0) throw new Error("NOT_FOUND");
    const root = rows[0]!;
    if (root.id !== pageId) throw new Error("NOT_FOUND");
    // 同 space「搬移」無意義且會使根頁 slug 與自身相撞而平白重生成：一律拒絕（同 space 排序走 movePageNode）。
    if (root.spaceId === targetSpaceId) throw new Error("SAME_SPACE");

    // 根頁移到目標 space 根層末尾（fractional index 取末位之後）。
    const lastRootPos = await lastChildPosition(tx, targetSpaceId, null);
    const rootPosition = positionBetween(lastRootPos, null);
    const now = new Date();

    for (const row of rows) {
      const slug = await freeSlugInTarget(tx, targetSpaceId, row.slug, row.title);
      const isRoot = row.id === root.id;
      await tx
        .update(pages)
        .set({
          spaceId: targetSpaceId,
          slug,
          // 根頁改掛目標根層；子孫維持原父（同屬搬移子樹，仍在目標 space 內）。
          ...(isRoot ? { parentId: null, position: rootPosition } : {}),
          updatedBy: movedBy,
          updatedAt: now,
        })
        .where(eq(pages.id, row.id));
    }

    const movedPageIds = rows.map((r) => r.id);
    // 附件歸屬轉移（G6）：子樹頁面所屬附件的 space_id 同步改指目的地 space，
    // 使下載 route 的 page.read 權限檢查即刻跟隨新 space。
    await tx
      .update(attachments)
      .set({ spaceId: targetSpaceId })
      .where(inArray(attachments.pageId, movedPageIds));

    const movedRoot = await tx.query.pages.findFirst({ where: eq(pages.id, root.id) });
    return { rootSlug: movedRoot?.slug ?? root.slug, movedPageIds };
  });
}

export interface CopyPageToSpaceInput {
  /** 被複製子樹的根頁面 */
  pageId: string;
  /** 目的地 space（權限由呼叫端薄殼先驗） */
  targetSpaceId: string;
  /** 操作者（新頁 created_by/updated_by、版本快照 created_by） */
  userId: string;
}

export interface CopyPageToSpaceResult {
  /** 複製出的根頁面 id 與 slug */
  newRootId: string;
  newRootSlug: string;
  /** 複製出的全部新頁面 id（供索引 enqueue） */
  copiedPageIds: string[];
}

/**
 * 跨 Space 深拷貝整支子樹（C-10，F-PAGE-05）：於單一交易內為子樹每頁建立
 * 全新頁面（新 id、目標 space 內唯一 slug、末尾 position），並**重用既有儲存管線**：
 * - 建頁走 `createPageInTx`（slug/position/reclaim 單一來源）；
 * - 內容走 `writePageContentTx`（三欄同交易同步 content/content_md/content_text ＋版本快照，架構鐵律 #5），
 *   不旁路內容管線。
 *
 * 父子關係以 old→new id 對應重建（根頁複製為目標根層節點）。內容 JSON 為原樣深拷貝：
 * 內文中的頁面連結／附件引用維持指向原頁／原附件（複製語意＝引用來源，不重製附件檔）。
 * 嵌入索引 enqueue 由呼叫端薄殼於交易提交後 fire-and-forget（不阻塞複製）。
 */
export async function copyPageSubtreeToSpace(
  input: CopyPageToSpaceInput,
): Promise<CopyPageToSpaceResult> {
  const { pageId, targetSpaceId, userId } = input;

  return db.transaction(async (tx) => {
    const rows = await fetchSubtree(tx, pageId);
    if (rows.length === 0) throw new Error("NOT_FOUND");
    const rootOldId = rows[0]!.id;
    if (rootOldId !== pageId) throw new Error("NOT_FOUND");

    const idMap = new Map<string, string>();
    for (const row of rows) {
      const newParentId = row.id === rootOldId ? null : idMap.get(row.parentId ?? "");
      // 父節點必先於子節點建立（fetchSubtree 依 depth 排序保證）；查不到對應＝資料異常。
      if (row.id !== rootOldId && !newParentId) throw new Error("COPY_PARENT_MISSING");

      const created = await createPageInTx(tx, {
        spaceId: targetSpaceId,
        parentId: newParentId ?? null,
        title: row.title,
        userId,
      });
      idMap.set(row.id, created.id);

      if (row.icon) {
        await tx.update(pages).set({ icon: row.icon }).where(eq(pages.id, created.id));
      }

      // 內容經儲存管線寫入：三欄同步 + 版本快照（新頁 currentVersionNo 由 0 起）。
      await writePageContentTx(tx, {
        pageId: created.id,
        pageTitle: created.title,
        expectedVersionNo: 0,
        content: row.content ?? EMPTY_DOC,
        userId,
      });
    }

    const newRootId = idMap.get(rootOldId)!;
    const newRoot = await tx.query.pages.findFirst({ where: eq(pages.id, newRootId) });
    return {
      newRootId,
      newRootSlug: newRoot?.slug ?? "",
      copiedPageIds: [...idMap.values()],
    };
  });
}
