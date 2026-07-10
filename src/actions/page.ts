"use server";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { pages, pageSlugHistory, spaces } from "@/lib/db/schema";
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
    return updated[0]!.versionNo;
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
