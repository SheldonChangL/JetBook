"use server";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { pages, pageSlugHistory, pageVersions, spaces } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { assertCan } from "@/lib/authz/permission";
import { positionBetween } from "@/lib/pages/position";
import { docToMarkdown, docToPlainText } from "@/lib/content/serialize";
import { EMPTY_DOC, type ProseMirrorDoc } from "@/lib/content/types";
import { logger } from "@/lib/logger";

function slugifyTitle(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return base && /[a-z0-9]/.test(base) ? base.slice(0, 48) : `p-${crypto.randomUUID().slice(0, 8)}`;
}

async function uniquePageSlug(spaceId: string, title: string): Promise<string> {
  const base = slugifyTitle(title);
  let candidate = base;
  for (let i = 2; ; i += 1) {
    const existing = await db.query.pages.findFirst({
      where: and(eq(pages.spaceId, spaceId), eq(pages.slug, candidate)),
    });
    if (!existing) return candidate;
    candidate = `${base}-${i}`;
  }
}

/** 取得某父節點下最後一個 position，供新節點接在末尾。 */
async function lastPositionUnder(spaceId: string, parentId: string | null): Promise<string | null> {
  const rows = await db
    .select({ position: pages.position })
    .from(pages)
    .where(
      and(
        eq(pages.spaceId, spaceId),
        parentId === null ? isNull(pages.parentId) : eq(pages.parentId, parentId),
        isNull(pages.deletedAt),
      ),
    )
    .orderBy(desc(pages.position))
    .limit(1);
  return rows[0]?.position ?? null;
}

async function requireEditor(spaceId: string) {
  const { user } = await requireSession();
  await assertCan(user, "page.edit", { type: "page", spaceId });
  return user;
}

const createSchema = z.object({
  spaceId: z.uuid(),
  parentId: z.uuid().nullable().default(null),
  title: z.string().trim().max(200).default(""),
});

export async function createPage(input: z.infer<typeof createSchema>) {
  const data = createSchema.parse(input);
  const user = await requireEditor(data.spaceId);
  const title = data.title || "未命名頁面";
  const slug = await uniquePageSlug(data.spaceId, title);
  const last = await lastPositionUnder(data.spaceId, data.parentId);
  const position = positionBetween(last, null);

  const [page] = await db
    .insert(pages)
    .values({
      spaceId: data.spaceId,
      parentId: data.parentId,
      title,
      slug,
      position,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  if (!page) throw new Error("page 建立失敗");

  logger.info({ userId: user.id, pageId: page.id, spaceId: data.spaceId }, "page created");
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, data.spaceId) });
  if (space) revalidatePath(`/s/${space.slug}`);
  return { id: page.id, slug: page.slug };
}

const renameSchema = z.object({
  pageId: z.uuid(),
  title: z.string().trim().min(1).max(200),
});

export async function renamePage(input: z.infer<typeof renameSchema>) {
  const data = renameSchema.parse(input);
  const page = await db.query.pages.findFirst({ where: eq(pages.id, data.pageId) });
  if (!page || page.deletedAt) throw new Error("NOT_FOUND");
  const user = await requireEditor(page.spaceId);

  const newSlug = await uniquePageSlug(page.spaceId, data.title);
  await db.transaction(async (tx) => {
    if (newSlug !== page.slug) {
      // 舊 slug 進歷史表供 301（G1）
      await tx
        .insert(pageSlugHistory)
        .values({ spaceId: page.spaceId, oldSlug: page.slug, pageId: page.id })
        .onConflictDoNothing();
    }
    await tx
      .update(pages)
      .set({ title: data.title, slug: newSlug, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(pages.id, page.id));
  });
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  if (space) revalidatePath(`/s/${space.slug}`);
  return { slug: newSlug };
}

const deleteSchema = z.object({ pageId: z.uuid() });

/** 軟刪除：整支子樹（含後代）一起進回收桶（F-PAGE-02）。 */
export async function deletePage(input: z.infer<typeof deleteSchema>) {
  const { pageId } = deleteSchema.parse(input);
  const page = await db.query.pages.findFirst({ where: eq(pages.id, pageId) });
  if (!page || page.deletedAt) throw new Error("NOT_FOUND");
  const user = await requireEditor(page.spaceId);

  const now = new Date();
  // recursive CTE 找出整支子樹並一次軟刪
  await db.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM ${pages} WHERE id = ${pageId}
      UNION ALL
      SELECT p.id FROM ${pages} p JOIN subtree s ON p.parent_id = s.id
    )
    UPDATE ${pages} SET deleted_at = ${now}
    WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL
  `);

  logger.info({ userId: user.id, pageId }, "page soft-deleted (subtree)");
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  if (space) revalidatePath(`/s/${space.slug}`);
}

/** Session 合併窗：同作者連續存檔於此時間內合併為單一版本（E-01）。 */
const SNAPSHOT_MERGE_MS = 5 * 60 * 1000;

export class VersionConflictError extends Error {
  constructor(public currentVersionNo: number) {
    super("VERSION_CONFLICT");
    this.name = "VersionConflictError";
  }
}

const saveSchema = z.object({
  pageId: z.uuid(),
  /** 樂觀鎖：用戶端載入時的版本號；不符即拒寫（C1 第二道防線） */
  expectedVersionNo: z.number().int().nonnegative(),
  /** TipTap/ProseMirror JSON（canonical） */
  content: z.custom<ProseMirrorDoc>((v) => typeof v === "object" && v !== null),
});

/**
 * 內容儲存管線（D-02，架構鐵律 #5）：同一交易內同步 content(JSON canonical)、
 * content_md、content_text 三欄位並遞增版本號；樂觀版本檢查為第二道防線。
 * 回傳新版本號。E-01 於同交易掛入版本快照；之後 enqueue embedding job（M2）。
 */
export async function savePage(input: z.infer<typeof saveSchema>): Promise<{ versionNo: number }> {
  const data = saveSchema.parse(input);
  const page = await db.query.pages.findFirst({ where: eq(pages.id, data.pageId) });
  if (!page || page.deletedAt) throw new Error("NOT_FOUND");
  const user = await requireEditor(page.spaceId);

  const doc = data.content ?? EMPTY_DOC;
  const contentMd = docToMarkdown(doc);
  const contentText = docToPlainText(doc);

  const nextVersion = await db.transaction(async (tx) => {
    // 樂觀鎖：以 WHERE current_version_no = expected 原子更新
    const updated = await tx
      .update(pages)
      .set({
        content: doc,
        contentMd,
        contentText,
        currentVersionNo: data.expectedVersionNo + 1,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(and(eq(pages.id, data.pageId), eq(pages.currentVersionNo, data.expectedVersionNo)))
      .returning({ versionNo: pages.currentVersionNo });

    if (updated.length === 0) {
      // 版本不符：讀回目前版本號供前端提示重載
      const fresh = await tx.query.pages.findFirst({ where: eq(pages.id, data.pageId) });
      throw new VersionConflictError(fresh?.currentVersionNo ?? 0);
    }
    const versionNo = updated[0]!.versionNo;

    // 版本快照（E-01，ADR-008 完整 JSON）：同交易寫入。
    // Session 合併：同一作者於 SNAPSHOT_MERGE_MS 內的連續存檔更新最後一筆快照，
    // 避免高頻 autosave 產生數百筆微版本。
    const last = await tx.query.pageVersions.findFirst({
      where: eq(pageVersions.pageId, data.pageId),
      orderBy: desc(pageVersions.versionNo),
    });
    const mergeable =
      last &&
      last.createdBy === user.id &&
      Date.now() - last.createdAt.getTime() < SNAPSHOT_MERGE_MS;

    if (mergeable) {
      await tx
        .update(pageVersions)
        .set({ versionNo, title: page.title, content: doc, contentMd, createdAt: new Date() })
        .where(eq(pageVersions.id, last.id));
    } else {
      await tx.insert(pageVersions).values({
        pageId: data.pageId,
        versionNo,
        title: page.title,
        content: doc,
        contentMd,
        createdBy: user.id,
      });
    }
    return versionNo;
  });

  logger.info({ userId: user.id, pageId: data.pageId, versionNo: nextVersion }, "page saved");
  return { versionNo: nextVersion };
}

/** 計算某頁的後代數量（刪除前顯示影響範圍用）。 */
export async function countDescendants(pageId: string): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM ${pages} WHERE id = ${pageId}
      UNION ALL
      SELECT p.id FROM ${pages} p JOIN subtree s ON p.parent_id = s.id
    )
    SELECT count(*)::int - 1 AS count FROM subtree
  `);
  return Number(result.rows[0]?.count ?? 0);
}

/** 版本歷史列表（新到舊）。需 space 讀取權。 */
export async function listPageVersions(pageId: string) {
  const { user } = await requireSession();
  const page = await db.query.pages.findFirst({ where: eq(pages.id, pageId) });
  if (!page) throw new Error("NOT_FOUND");
  await assertCan(user, "page.read", { type: "page", spaceId: page.spaceId });
  return db
    .select({
      id: pageVersions.id,
      versionNo: pageVersions.versionNo,
      title: pageVersions.title,
      createdBy: pageVersions.createdBy,
      createdAt: pageVersions.createdAt,
      note: pageVersions.note,
    })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.versionNo));
}

const restoreSchema = z.object({ pageId: z.uuid(), versionNo: z.number().int().positive() });

/**
 * 還原至指定版本（E-01 F-VER-03）：不可變歷史——還原本身產生新版本，
 * 重用 savePage 儲存管線（三欄同步 + 快照），不旁路（架構鐵律 #5）。
 */
export async function restorePageVersion(input: z.infer<typeof restoreSchema>) {
  const data = restoreSchema.parse(input);
  const page = await db.query.pages.findFirst({ where: eq(pages.id, data.pageId) });
  if (!page || page.deletedAt) throw new Error("NOT_FOUND");
  await requireEditor(page.spaceId);

  const target = await db.query.pageVersions.findFirst({
    where: and(eq(pageVersions.pageId, data.pageId), eq(pageVersions.versionNo, data.versionNo)),
  });
  if (!target) throw new Error("NOT_FOUND");

  const doc = (target.content as ProseMirrorDoc | null) ?? EMPTY_DOC;
  // 以還原內容走一次 savePage（新版本、快照、衍生欄位一致）
  const result = await savePage({
    pageId: data.pageId,
    expectedVersionNo: page.currentVersionNo,
    content: doc,
  });
  // 標記還原來源
  await db
    .update(pageVersions)
    .set({ note: `還原自 v${data.versionNo}` })
    .where(and(eq(pageVersions.pageId, data.pageId), eq(pageVersions.versionNo, result.versionNo)));
  return result;
}

/** 讀取整棵 space 頁面樹（未刪除，依 position 排序；recursive CTE，ADR-001）。 */
export async function listSpaceTree(spaceId: string) {
  return db
    .select({
      id: pages.id,
      parentId: pages.parentId,
      title: pages.title,
      slug: pages.slug,
      icon: pages.icon,
      position: pages.position,
    })
    .from(pages)
    .where(and(eq(pages.spaceId, spaceId), isNull(pages.deletedAt)))
    .orderBy(asc(pages.position));
}
