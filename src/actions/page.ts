"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { pages, pageVersions, spaces, users } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { assertCan } from "@/lib/authz/permission";
import { positionBetween } from "@/lib/pages/position";
import { movePageNode } from "@/lib/pages/move";
import { listSpaceTreeNodes } from "@/lib/pages/tree";
import { reclaimSlug, recordSlugHistory, uniquePageSlug } from "@/lib/pages/slug";
import { docToMarkdown, docToPlainText } from "@/lib/content/serialize";
import { buildMarkdownImport } from "@/lib/content/import-markdown";
import { EMPTY_DOC, type ProseMirrorDoc } from "@/lib/content/types";
import { VersionConflictError } from "@/lib/pages/errors";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

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
    // fractional index 為 base-62 位元組序鍵：必須 COLLATE "C" 排序（C-04 修正）
    .orderBy(desc(sql`${pages.position} COLLATE "C"`))
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

  const page = await db.transaction(async (tx) => {
    const [created] = await tx
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
    if (!created) throw new Error("page 建立失敗");
    // 新頁佔用此 slug → 清掉指向他頁的同名舊 slug 歷史（避免陳舊 301）
    await reclaimSlug(tx, data.spaceId, slug);
    return created;
  });

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

  // 排除頁面自身：改名為同義標題（slug 不變）時不因自撞而平白產生尾碼
  const newSlug = await uniquePageSlug(page.spaceId, data.title, { excludePageId: page.id });
  await db.transaction(async (tx) => {
    if (newSlug !== page.slug) {
      // 舊 slug 進歷史表供 301（G1）
      await recordSlugHistory(tx, page.spaceId, page.slug, page.id);
      // 新 slug 若曾是他頁的舊 slug → 清除該歷史（本頁現行佔用，避免陳舊 301）
      await reclaimSlug(tx, page.spaceId, newSlug);
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

const moveSchema = z.object({
  pageId: z.uuid(),
  /** 新父節點；null＝根層 */
  newParentId: z.uuid().nullable().default(null),
  /** 插在此兄弟節點之前（與 afterId 擇一；都省略＝接在末尾） */
  beforeId: z.uuid().optional(),
  /** 插在此兄弟節點之後 */
  afterId: z.uuid().optional(),
});

/**
 * 搬移／排序頁面（C-04）：fractional index 只改單一節點；
 * 循環防護（recursive CTE）與 position 計算在 lib 層同一交易內完成。
 */
export async function movePage(input: z.infer<typeof moveSchema>) {
  const data = moveSchema.parse(input);
  const page = await db.query.pages.findFirst({ where: eq(pages.id, data.pageId) });
  if (!page || page.deletedAt) throw new Error("NOT_FOUND");
  const user = await requireEditor(page.spaceId);

  await movePageNode({
    pageId: data.pageId,
    newParentId: data.newParentId,
    beforeId: data.beforeId ?? null,
    afterId: data.afterId ?? null,
    movedBy: user.id,
  });

  logger.info(
    { userId: user.id, pageId: data.pageId, newParentId: data.newParentId },
    "page moved",
  );
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  if (space) revalidatePath(`/s/${space.slug}`);
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
  await writeAudit({
    actorId: user.id,
    action: "page.delete",
    targetType: "page",
    targetId: pageId,
    metadata: { spaceId: page.spaceId, title: page.title },
    ip: ipFromHeaders(await headers()),
  });
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  if (space) revalidatePath(`/s/${space.slug}`);
}

/** Session 合併窗：同作者連續存檔於此時間內合併為單一版本（E-01）。 */
const SNAPSHOT_MERGE_MS = 5 * 60 * 1000;

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

/** 單檔 Markdown 匯入文字大小上限（請求安全防護，非 NFR 容量規格）。 */
const IMPORT_MARKDOWN_MAX_CHARS = 2 * 1024 * 1024; // 2 MiB 純文字

const importMarkdownSchema = z.object({
  spaceId: z.uuid(),
  /** 匯入位置父節點；null＝根層（單檔匯入預設根層） */
  parentId: z.uuid().nullable().default(null),
  fileName: z.string().trim().min(1).max(255),
  markdown: z.string().min(1).max(IMPORT_MARKDOWN_MAX_CHARS),
});

/**
 * 單檔 Markdown 匯入（J-01，F-IE-01）：markdown → doc（markdown-to-doc 轉換器）→
 * createPage 建頁 → savePage 寫入內容。權限（page.edit）與三欄同交易同步一律由
 * createPage / savePage 既有管線負責，不旁路（架構鐵律 #5、#6）。回傳新頁 id 與 slug。
 */
export async function importMarkdownPage(
  input: z.input<typeof importMarkdownSchema>,
): Promise<{ id: string; slug: string }> {
  const data = importMarkdownSchema.parse(input);
  const { title, doc } = buildMarkdownImport(data.markdown, data.fileName);

  // createPage 內含 requireEditor（session + page.edit 授權檢查）與 slug 配置。
  const { id, slug } = await createPage({
    spaceId: data.spaceId,
    parentId: data.parentId,
    title,
  });
  // 新頁 currentVersionNo 預設 0；以樂觀鎖初值走一次儲存管線寫入匯入內容（三欄同步 + 版本快照）。
  await savePage({ pageId: id, expectedVersionNo: 0, content: doc });

  logger.info(
    { pageId: id, spaceId: data.spaceId, fileName: data.fileName },
    "markdown page imported",
  );
  return { id, slug };
}

/** 計算某頁的後代數量（刪除前顯示影響範圍用）。需 space 讀取權。 */
export async function countDescendants(input: string): Promise<number> {
  const pageId = z.uuid().parse(input);
  const { user } = await requireSession();
  const page = await db.query.pages.findFirst({ where: eq(pages.id, pageId) });
  if (!page || page.deletedAt) throw new Error("NOT_FOUND");
  await assertCan(user, "page.read", { type: "page", spaceId: page.spaceId });
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

/** 版本歷史列表（新到舊，含作者名；E-02）。需 space 讀取權。 */
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
      /** 作者名；作者帳號被刪除（created_by set null）時為 null */
      authorName: users.name,
      createdAt: pageVersions.createdAt,
      note: pageVersions.note,
    })
    .from(pageVersions)
    .leftJoin(users, eq(pageVersions.createdBy, users.id))
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
  const user = await requireEditor(page.spaceId);

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
  await writeAudit({
    actorId: user.id,
    action: "page.restore_version",
    targetType: "page",
    targetId: data.pageId,
    metadata: {
      spaceId: page.spaceId,
      fromVersionNo: data.versionNo,
      newVersionNo: result.versionNo,
    },
    ip: ipFromHeaders(await headers()),
  });
  return result;
}

/** 讀取整棵 space 頁面樹（未刪除，依 position 排序；ADR-001）。需 space 讀取權。 */
export async function listSpaceTree(input: string) {
  const spaceId = z.uuid().parse(input);
  const { user } = await requireSession();
  await assertCan(user, "page.read", { type: "page", spaceId });
  return listSpaceTreeNodes(spaceId);
}
