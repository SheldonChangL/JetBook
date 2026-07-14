import "server-only";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { HasChildrenError } from "@/lib/pages/errors";
import { positionBetween } from "@/lib/pages/position";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * 回收桶（C-08，F-PAGE-06）資料存取層。
 *
 * 軟刪除模型（見 actions/page.ts deletePage）：刪除整支子樹於同一交易將
 * `deleted_at` 設為同一時間戳（＝一「批」）。回收桶只列出每批的「頂節點」
 * （父節點未刪、或父節點屬於不同批），還原時連帶還原同批的後代子樹。
 *
 * 權限：本模組為純資料存取，不做權限判斷。呼叫端（RSC／Server Action）
 * 必須先經 lib/authz 取得可管理的 spaceId 集合或斷言 page.delete（架構鐵律 #1）。
 */

/** 已刪頁面保留天數；逾期由 worker cron（purge-trash）永久清除。 */
export const TRASH_RETENTION_DAYS = 30;

export interface TrashItem {
  pageId: string;
  spaceId: string;
  spaceSlug: string;
  spaceName: string;
  spaceIcon: string | null;
  title: string;
  icon: string | null;
  deletedAt: Date;
  /** 刪除者 user id（由 audit_logs 的 page.delete 事件解析）；帳號已刪或無稽核為 null */
  deleterId: string | null;
  deleterName: string | null;
  /** 同批一併刪除的後代數（不含本節點）；還原時連帶還原 */
  descendantCount: number;
}

/**
 * 列出指定 space 集合的回收桶項目（每批頂節點，deleted_at 由新到舊）。
 * 呼叫端負責把 spaceIds 限定在使用者有還原權限（editor+）的範圍。
 */
export async function listTrashItems(spaceIds: string[]): Promise<TrashItem[]> {
  if (spaceIds.length === 0) return [];
  const idList = sql.join(
    spaceIds.map((id) => sql`${id}`),
    sql`, `,
  );

  const result = await db.execute<{
    page_id: string;
    space_id: string;
    space_slug: string;
    space_name: string;
    space_icon: string | null;
    title: string;
    icon: string | null;
    deleted_at: string;
    deleter_id: string | null;
    deleter_name: string | null;
    descendant_count: number;
  }>(sql`
    WITH RECURSIVE roots AS (
      SELECT p.id, p.space_id, p.title, p.icon, p.deleted_at
      FROM pages p
      LEFT JOIN pages par ON par.id = p.parent_id
      WHERE p.deleted_at IS NOT NULL
        AND p.space_id IN (${idList})
        AND (
          p.parent_id IS NULL
          OR par.deleted_at IS NULL
          OR par.deleted_at <> p.deleted_at
        )
    ),
    subtree AS (
      SELECT r.id AS root_id, r.id AS node_id, r.deleted_at AS batch
      FROM roots r
      UNION ALL
      SELECT s.root_id, c.id, s.batch
      FROM subtree s
      JOIN pages c ON c.parent_id = s.node_id AND c.deleted_at = s.batch
    ),
    counts AS (
      SELECT root_id, count(*)::int AS total FROM subtree GROUP BY root_id
    )
    SELECT
      r.id AS page_id,
      r.space_id AS space_id,
      s.slug AS space_slug,
      s.name AS space_name,
      s.icon AS space_icon,
      r.title AS title,
      r.icon AS icon,
      r.deleted_at AS deleted_at,
      a.actor_id AS deleter_id,
      u.name AS deleter_name,
      COALESCE(cnt.total, 1) - 1 AS descendant_count
    FROM roots r
    JOIN spaces s ON s.id = r.space_id
    LEFT JOIN LATERAL (
      SELECT actor_id FROM audit_logs
      WHERE action = 'page.delete' AND target_id = r.id::text
      ORDER BY created_at DESC
      LIMIT 1
    ) a ON true
    LEFT JOIN users u ON u.id = a.actor_id
    LEFT JOIN counts cnt ON cnt.root_id = r.id
    ORDER BY r.deleted_at DESC
  `);

  return result.rows.map((row) => ({
    pageId: row.page_id,
    spaceId: row.space_id,
    spaceSlug: row.space_slug,
    spaceName: row.space_name,
    spaceIcon: row.space_icon,
    title: row.title,
    icon: row.icon,
    deletedAt: new Date(row.deleted_at),
    deleterId: row.deleter_id,
    deleterName: row.deleter_name,
    descendantCount: Number(row.descendant_count),
  }));
}

/**
 * 軟刪除一支子樹（C-08）：同一交易內以 recursive CTE 將整支子樹的 `deleted_at`
 * 設為同一時間戳（＝一「批」，還原時連帶還原）。web deletePage（無條件連子樹）與
 * API delete_page（M4-15，`recursive:false` 時有未刪子頁即拒絕）共用的唯一刪除路徑。
 * 權限由呼叫端薄殼先驗（架構鐵律 #1）；embedding 清除由呼叫端於交易後 enqueue。
 * 回傳受影響（本次被軟刪）的頁面 id 清單。
 */
export async function softDeletePageSubtree(input: {
  pageId: string;
  /** false 且存在未刪除子頁 → 擲 HasChildrenError（帶子頁數）。 */
  recursive: boolean;
}): Promise<{ deletedIds: string[] }> {
  return db.transaction(async (tx) => {
    const page = await tx.query.pages.findFirst({ where: eq(pages.id, input.pageId) });
    if (!page || page.deletedAt) throw new Error("NOT_FOUND");

    const now = new Date();
    if (!input.recursive) {
      const [kids] = await tx
        .select({ n: count() })
        .from(pages)
        .where(and(eq(pages.parentId, input.pageId), isNull(pages.deletedAt)));
      if ((kids?.n ?? 0) > 0) throw new HasChildrenError(kids!.n);
      // 只刪單列、不跑子樹 CTE：count 與 CTE 之間的並發新增子頁不會被連帶誤刪，
      // 已軟刪子頁下的活孫頁（直接子頁 count 看不到）也不會被 CTE 穿越刪掉
      const deleted = await tx
        .update(pages)
        .set({ deletedAt: now })
        .where(and(eq(pages.id, input.pageId), isNull(pages.deletedAt)))
        .returning({ id: pages.id });
      return { deletedIds: deleted.map((row) => row.id) };
    }

    const deleted = await tx.execute<{ id: string }>(sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM ${pages} WHERE id = ${input.pageId}
        UNION ALL
        SELECT p.id FROM ${pages} p JOIN subtree s ON p.parent_id = s.id
      )
      UPDATE ${pages} SET deleted_at = ${now}
      WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL
      RETURNING id
    `);
    return { deletedIds: deleted.rows.map((row) => row.id) };
  });
}

export interface RestoreResult {
  spaceId: string;
  title: string;
  /** 原父節點已刪除／不存在，改掛回最上層 */
  reparentedToRoot: boolean;
}

/**
 * 還原一支被刪子樹（同批 deleted_at）：清除子樹的 deleted_at；若頂節點的原父
 * 已刪除或不存在，改掛回最上層（parent_id=null，取一新末尾 position）。
 * 內容不變（非內容寫入，不走 savePage 管線）；embedding 於刪除時未清除，
 * 還原後即恢復進搜尋／RAG（getAccessiblePageIds 以 deleted_at 過濾）。
 */
export async function restoreTrashPage(input: {
  pageId: string;
  userId: string;
}): Promise<RestoreResult> {
  return db.transaction(async (tx) => {
    const page = await tx.query.pages.findFirst({ where: eq(pages.id, input.pageId) });
    if (!page || !page.deletedAt) throw new Error("NOT_FOUND");

    // 頂節點原父是否仍存在且未刪：否則還原後掛回最上層
    let reparentToRoot = false;
    if (page.parentId) {
      const parent = await tx.query.pages.findFirst({ where: eq(pages.id, page.parentId) });
      if (!parent || parent.deletedAt) reparentToRoot = true;
    }

    // 掛回最上層需取末尾 position——需在清除 deleted_at 之前計算
    //（此時本頁仍屬已刪，不會把自己算進去）。
    let rootPosition: string | null = null;
    if (reparentToRoot) {
      const last = await tx
        .select({ position: pages.position })
        .from(pages)
        .where(
          and(eq(pages.spaceId, page.spaceId), isNull(pages.parentId), isNull(pages.deletedAt)),
        )
        .orderBy(desc(sql`${pages.position} COLLATE "C"`))
        .limit(1);
      rootPosition = positionBetween(last[0]?.position ?? null, null);
    }

    // 清除同批子樹的 deleted_at（deleted_at 比較全程在 DB 端，免 JS 時間精度問題）。
    await tx.execute(sql`
      WITH RECURSIVE root AS (
        SELECT id, deleted_at FROM pages WHERE id = ${input.pageId}
      ),
      subtree AS (
        SELECT p.id FROM pages p JOIN root r ON p.id = r.id
        UNION ALL
        SELECT c.id FROM pages c JOIN subtree s ON c.parent_id = s.id
        WHERE c.deleted_at = (SELECT deleted_at FROM root)
      )
      UPDATE pages
      SET deleted_at = NULL, updated_at = now(), updated_by = ${input.userId}
      WHERE id IN (SELECT id FROM subtree)
    `);

    if (reparentToRoot && rootPosition !== null) {
      await tx
        .update(pages)
        .set({ parentId: null, position: rootPosition })
        .where(eq(pages.id, input.pageId));
    }

    return { spaceId: page.spaceId, title: page.title, reparentedToRoot: reparentToRoot };
  });
}

/**
 * 永久清除逾期回收桶頁面（worker cron，purge-trash）。硬刪 deleted_at 早於
 * (now − retentionDays) 的頁面；FK cascade 連帶清除版本／向量／slug 歷史／瀏覽記錄，
 * 附件 page_id 置 null（保留檔案，見 schema 註）。回傳清除筆數。
 */
export async function purgeExpiredTrash(
  retentionDays: number = TRASH_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await db.execute<{ id: string }>(sql`
    DELETE FROM pages
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
    RETURNING id
  `);
  const purged = result.rows.length;
  if (purged > 0) {
    await writeAudit({
      action: "page.purge_expired",
      targetType: "trash",
      metadata: { purgedCount: purged, retentionDays, cutoff: cutoff.toISOString() },
    });
    logger.info({ purged, retentionDays }, "expired trash pages purged");
  }
  return purged;
}
