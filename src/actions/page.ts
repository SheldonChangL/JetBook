"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { pageEmbeddings, pages, pageVersions, spaces, users } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { triggerEmbedPage } from "@/lib/jobs/queue";
import { isEmbeddingConfigured } from "@/lib/llm";
import { assertCan, getEditableSpaceIds } from "@/lib/authz/permission";
import { movePageNode } from "@/lib/pages/move";
import { copyPageSubtreeToSpace, movePageSubtreeToSpace } from "@/lib/pages/cross-space";
import { listSpaceTreeNodes } from "@/lib/pages/tree";
import { reclaimSlug, uniquePageSlug } from "@/lib/pages/slug";
import { renamePageTx } from "@/lib/pages/rename";
import { createPageInTx } from "@/lib/pages/create";
import { writePageContentTx } from "@/lib/pages/content-write";
import { buildMarkdownImport } from "@/lib/content/import-markdown";
import { docxToMarkdown, imageFileName, DOCX_IMAGE_SCHEME } from "@/lib/content/import-docx";
import { saveAttachment, UploadValidationError } from "@/lib/storage/upload";
import { newlyMentionedUserIds } from "@/lib/content/mentions";
import { notifyPageMention } from "@/lib/notifications";
import { EMPTY_DOC, type ProseMirrorDoc } from "@/lib/content/types";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

async function requireEditor(spaceId: string) {
  const { user } = await requireSession();
  await assertCan(user, "page.edit", { type: "page", spaceId });
  return user;
}

/**
 * 對「確實有向量」的頁面批次 enqueue 重嵌（跨 space 搬移後重評目的地 space 的 AI 索引政策，
 * NFR-COMP-03；handler 依現行 space 決定重建或清除）。整段 best-effort：任何失敗都不得
 * 阻塞搬移主流程（RAG 檢索本以現行 space join 過濾，向量新鮮度非安全條件）。
 */
async function reembedIndexedPages(pageIds: string[]): Promise<void> {
  if (!isEmbeddingConfigured() || pageIds.length === 0) return;
  try {
    const indexed = await db
      .select({ pageId: pageEmbeddings.pageId })
      .from(pageEmbeddings)
      .where(inArray(pageEmbeddings.pageId, pageIds))
      .groupBy(pageEmbeddings.pageId);
    for (const { pageId } of indexed) await triggerEmbedPage(pageId);
  } catch (error) {
    logger.error({ err: error }, "跨 space 搬移後重嵌 enqueue 失敗（不阻塞搬移）");
  }
}

const createSchema = z.object({
  spaceId: z.uuid(),
  parentId: z.uuid().nullable().default(null),
  title: z.string().trim().max(200).default(""),
});

export async function createPage(input: z.infer<typeof createSchema>) {
  const data = createSchema.parse(input);
  const user = await requireEditor(data.spaceId);

  // 建頁核心（slug/position/insert/reclaim）走 lib/pages/create，與匯入 worker 共用單一來源。
  const page = await db.transaction((tx) =>
    createPageInTx(tx, {
      spaceId: data.spaceId,
      parentId: data.parentId,
      title: data.title,
      userId: user.id,
    }),
  );

  logger.info({ userId: user.id, pageId: page.id, spaceId: data.spaceId }, "page created");
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, data.spaceId) });
  if (space) revalidatePath(`/s/${space.slug}`);
  return { id: page.id, slug: page.slug };
}

/** external_link 目標 URL 驗證：僅允許 http/https 絕對網址（擋 javascript:／相對路徑等）。 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const externalUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(isHttpUrl, { message: "EXTERNAL_URL_INVALID" });

const createGroupSchema = z.object({
  spaceId: z.uuid(),
  parentId: z.uuid().nullable().default(null),
  title: z.string().trim().min(1).max(200),
});

/**
 * 建立群組分節節點（C-11，F-PAGE-04）：僅結構、無內文、不可開啟為頁面。
 * 薄殼：驗 session → 驗 page.edit → createPageInTx(kind='group')。回傳新節點 id（不導頁）。
 */
export async function createGroupNode(input: z.infer<typeof createGroupSchema>) {
  const data = createGroupSchema.parse(input);
  const user = await requireEditor(data.spaceId);
  const node = await db.transaction((tx) =>
    createPageInTx(tx, {
      spaceId: data.spaceId,
      parentId: data.parentId,
      title: data.title,
      userId: user.id,
      kind: "group",
    }),
  );
  logger.info({ userId: user.id, pageId: node.id, spaceId: data.spaceId }, "group node created");
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, data.spaceId) });
  if (space) revalidatePath(`/s/${space.slug}`);
  return { id: node.id };
}

const createExternalLinkSchema = z.object({
  spaceId: z.uuid(),
  parentId: z.uuid().nullable().default(null),
  title: z.string().trim().min(1).max(200),
  url: externalUrlSchema,
});

/**
 * 建立外部連結節點（C-11，F-PAGE-04）：點擊以新分頁開啟目標 URL，無內文、無子節點。
 * 薄殼：驗 session → 驗 page.edit → createPageInTx(kind='external_link', externalUrl)。
 */
export async function createExternalLinkNode(input: z.infer<typeof createExternalLinkSchema>) {
  const data = createExternalLinkSchema.parse(input);
  const user = await requireEditor(data.spaceId);
  const node = await db.transaction((tx) =>
    createPageInTx(tx, {
      spaceId: data.spaceId,
      parentId: data.parentId,
      title: data.title,
      userId: user.id,
      kind: "external_link",
      externalUrl: data.url,
    }),
  );
  logger.info(
    { userId: user.id, pageId: node.id, spaceId: data.spaceId },
    "external link node created",
  );
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, data.spaceId) });
  if (space) revalidatePath(`/s/${space.slug}`);
  return { id: node.id };
}

const updateExternalLinkSchema = z.object({
  pageId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  url: externalUrlSchema,
});

/**
 * 編輯外部連結節點（C-11）：更新標題與目標 URL。薄殼：驗 session → 驗 page.edit →
 * 同交易內更新標題／slug／external_url。外部節點無內部 URL，故不寫 slug 301 歷史，
 * 僅 reclaim 同名舊 slug 以維持唯一性。
 */
export async function updateExternalLink(input: z.infer<typeof updateExternalLinkSchema>) {
  const data = updateExternalLinkSchema.parse(input);
  const page = await db.query.pages.findFirst({ where: eq(pages.id, data.pageId) });
  if (!page || page.deletedAt || page.kind !== "external_link") throw new Error("NOT_FOUND");
  const user = await requireEditor(page.spaceId);

  const newSlug = await uniquePageSlug(page.spaceId, data.title, { excludePageId: page.id });
  await db.transaction(async (tx) => {
    if (newSlug !== page.slug) await reclaimSlug(tx, page.spaceId, newSlug);
    await tx
      .update(pages)
      .set({
        title: data.title,
        slug: newSlug,
        externalUrl: data.url,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(pages.id, page.id));
  });
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  if (space) revalidatePath(`/s/${space.slug}`);
  return { id: page.id };
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

  // 改名核心（slug 重算＋301 歷史）抽至 lib/pages/rename.ts，與 API 寫入共用（M4-13）
  const renamed = await db.transaction(async (tx) =>
    renamePageTx(tx, {
      page: { id: page.id, spaceId: page.spaceId, slug: page.slug },
      title: data.title,
      userId: user.id,
    }),
  );
  if (!renamed) throw new Error("NOT_FOUND");
  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  if (space) revalidatePath(`/s/${space.slug}`);
  return { slug: renamed.slug };
}

const iconSchema = z.object({
  pageId: z.uuid(),
  /** native emoji 字串；null＝清除 */
  icon: z.string().trim().min(1).max(16).nullable(),
});

/** 設定頁面 emoji 圖示（M4-03，issue #194）：編輯權即可，不動 slug/內容/版本。 */
export async function setPageIcon(input: z.infer<typeof iconSchema>) {
  const data = iconSchema.parse(input);
  const page = await db.query.pages.findFirst({ where: eq(pages.id, data.pageId) });
  if (!page || page.deletedAt) throw new Error("NOT_FOUND");
  const user = await requireEditor(page.spaceId);

  await db
    .update(pages)
    .set({ icon: data.icon, updatedBy: user.id, updatedAt: new Date() })
    .where(eq(pages.id, page.id));

  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  if (space) revalidatePath(`/s/${space.slug}`);
  return { icon: data.icon };
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

const crossSpaceSchema = z.object({
  pageId: z.uuid(),
  /** 目的地 space */
  targetSpaceId: z.uuid(),
});

/**
 * 列出可作為移動／複製目的地的 Space（C-10）：使用者具 editor+ 的未封存未刪除 space，
 * 排除來源 space。權限在 lib/authz（getEditableSpaceIds，SQL 層過濾）判定，非事後過濾。
 */
export async function listMoveTargetSpaces(
  input?: string,
): Promise<{ id: string; slug: string; name: string }[]> {
  const { user } = await requireSession();
  const excludeSpaceId = input ? z.uuid().parse(input) : null;
  const editableIds = await getEditableSpaceIds(user);
  const targetIds = editableIds.filter((id) => id !== excludeSpaceId);
  if (targetIds.length === 0) return [];
  return db
    .select({ id: spaces.id, slug: spaces.slug, name: spaces.name })
    .from(spaces)
    .where(inArray(spaces.id, targetIds))
    .orderBy(spaces.name);
}

/**
 * 跨 Space 搬移整支子樹（C-10，F-PAGE-05）。薄殼：驗 session → 驗來源 page.edit 與
 * 目標 page.edit（editor）→ 呼叫 lib（space_id/slug/附件歸屬同交易轉移）。回傳新根 slug 與
 * 目標 space slug 供前端導向。搬移後重嵌受影響頁（best-effort）並改寫兩側 space 快取。
 */
export async function movePageToSpace(input: z.infer<typeof crossSpaceSchema>) {
  const data = crossSpaceSchema.parse(input);
  const page = await db.query.pages.findFirst({ where: eq(pages.id, data.pageId) });
  if (!page || page.deletedAt) throw new Error("NOT_FOUND");
  if (data.targetSpaceId === page.spaceId) throw new Error("SAME_SPACE");

  const { user } = await requireSession();
  // 來源需可編輯（移出）＋目標需 editor（移入）——兩側皆走 lib/authz 唯一入口。
  await assertCan(user, "page.edit", { type: "page", spaceId: page.spaceId });
  await assertCan(user, "page.edit", { type: "page", spaceId: data.targetSpaceId });

  const sourceSpace = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  const targetSpace = await db.query.spaces.findFirst({ where: eq(spaces.id, data.targetSpaceId) });
  if (!targetSpace || targetSpace.deletedAt) throw new Error("NOT_FOUND");

  const { rootSlug, movedPageIds } = await movePageSubtreeToSpace({
    pageId: data.pageId,
    targetSpaceId: data.targetSpaceId,
    movedBy: user.id,
  });

  await reembedIndexedPages(movedPageIds);

  logger.info(
    { userId: user.id, pageId: data.pageId, fromSpace: page.spaceId, toSpace: data.targetSpaceId },
    "page moved across spaces",
  );
  await writeAudit({
    actorId: user.id,
    action: "page.move_space",
    targetType: "page",
    targetId: data.pageId,
    metadata: { fromSpaceId: page.spaceId, toSpaceId: data.targetSpaceId, movedCount: movedPageIds.length },
    ip: ipFromHeaders(await headers()),
  });
  if (sourceSpace) revalidatePath(`/s/${sourceSpace.slug}`);
  revalidatePath(`/s/${targetSpace.slug}`);
  return { rootSlug, targetSpaceSlug: targetSpace.slug };
}

/**
 * 跨 Space 深拷貝整支子樹（C-10，F-PAGE-05）。薄殼：驗 session → 驗來源 page.read 與
 * 目標 page.edit（editor）→ 呼叫 lib（重用 createPage/savePage 管線建頁與寫內容）。
 * 交易提交後才 enqueue 嵌入索引（架構鐵律 #5：儲存管線之後）。回傳新根 slug 與目標 space slug。
 */
export async function copyPageToSpace(input: z.infer<typeof crossSpaceSchema>) {
  const data = crossSpaceSchema.parse(input);
  const page = await db.query.pages.findFirst({ where: eq(pages.id, data.pageId) });
  if (!page || page.deletedAt) throw new Error("NOT_FOUND");

  const { user } = await requireSession();
  // 複製只需能讀來源、能編輯目標（新增頁面）。
  await assertCan(user, "page.read", { type: "page", spaceId: page.spaceId });
  await assertCan(user, "page.edit", { type: "page", spaceId: data.targetSpaceId });

  const targetSpace = await db.query.spaces.findFirst({ where: eq(spaces.id, data.targetSpaceId) });
  if (!targetSpace || targetSpace.deletedAt) throw new Error("NOT_FOUND");

  const { newRootSlug, copiedPageIds, indexablePageIds } = await copyPageSubtreeToSpace({
    pageId: data.pageId,
    targetSpaceId: data.targetSpaceId,
    userId: user.id,
  });

  // 交易提交後為每個新內容頁 enqueue 嵌入索引（fire-and-forget，不阻塞複製）。
  // 群組／外部連結節點無內文、不進 RAG，故不 enqueue（indexablePageIds 已排除）。
  for (const id of indexablePageIds) await triggerEmbedPage(id);

  logger.info(
    { userId: user.id, pageId: data.pageId, toSpace: data.targetSpaceId, copiedCount: copiedPageIds.length },
    "page copied across spaces",
  );
  await writeAudit({
    actorId: user.id,
    action: "page.copy_space",
    targetType: "page",
    targetId: data.pageId,
    metadata: { toSpaceId: data.targetSpaceId, copiedCount: copiedPageIds.length },
    ip: ipFromHeaders(await headers()),
  });
  revalidatePath(`/s/${targetSpace.slug}`);
  return { rootSlug: newRootSlug, targetSpaceSlug: targetSpace.slug };
}

const deleteSchema = z.object({ pageId: z.uuid() });

/** 軟刪除：整支子樹（含後代）一起進回收桶（F-PAGE-02）。 */
export async function deletePage(input: z.infer<typeof deleteSchema>) {
  const { pageId } = deleteSchema.parse(input);
  const page = await db.query.pages.findFirst({ where: eq(pages.id, pageId) });
  if (!page || page.deletedAt) throw new Error("NOT_FOUND");
  const user = await requireEditor(page.spaceId);

  const now = new Date();
  // recursive CTE 找出整支子樹並一次軟刪；RETURNING 取受影響 id 供清除向量索引
  const deleted = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM ${pages} WHERE id = ${pageId}
      UNION ALL
      SELECT p.id FROM ${pages} p JOIN subtree s ON p.parent_id = s.id
    )
    UPDATE ${pages} SET deleted_at = ${now}
    WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL
    RETURNING id
  `);

  logger.info({ userId: user.id, pageId }, "page soft-deleted (subtree)");

  // 軟刪清除向量（H-06）：重用 embed 管線——handler 見 deletedAt 即刪向量。
  // 只對「確實有向量」的頁面 enqueue（避免整棵子樹空派工）。整段包 try/catch：
  // 索引清除的任何失敗都不得阻塞刪除流程或後續稽核（驗收：不阻塞編輯）。
  if (isEmbeddingConfigured()) {
    try {
      const deletedIds = deleted.rows.map((row) => row.id);
      if (deletedIds.length > 0) {
        const indexed = await db
          .select({ pageId: pageEmbeddings.pageId })
          .from(pageEmbeddings)
          .where(inArray(pageEmbeddings.pageId, deletedIds))
          .groupBy(pageEmbeddings.pageId);
        for (const { pageId: indexedId } of indexed) {
          await triggerEmbedPage(indexedId);
        }
      }
    } catch (error) {
      logger.error({ err: error, pageId }, "軟刪清除向量 enqueue 失敗（不阻塞刪除）");
    }
  }
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

  // 三欄同交易同步 + 版本快照走 lib/pages/content-write（唯一內容管線，架構鐵律 #5），
  // 匯入 worker 亦呼叫同一函式。
  const nextVersion = await db.transaction((tx) =>
    writePageContentTx(tx, {
      pageId: data.pageId,
      pageTitle: page.title,
      expectedVersionNo: data.expectedVersionNo,
      content: data.content ?? EMPTY_DOC,
      userId: user.id,
    }),
  );

  logger.info({ userId: user.id, pageId: data.pageId, versionNo: nextVersion }, "page saved");
  // 三欄同交易提交後才 enqueue 嵌入索引（架構鐵律 #5：儲存管線之後）。
  await triggerEmbedPage(data.pageId);
  // D-11：以新舊內容 diff 出「本次新增」的 @mention，通知被提及者（K-02）。
  // notifyPageMention 內部驗讀取權、略過本人/停用、且失敗不擲出——絕不阻塞存檔。
  const added = newlyMentionedUserIds(page.content as ProseMirrorDoc | null, data.content);
  if (added.length > 0) {
    await notifyPageMention({
      pageId: data.pageId,
      actorId: user.id,
      actorName: user.name,
      mentionedUserIds: added,
    });
  }
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

/** 單檔 .docx 匯入大小上限（與附件上傳上限一致由 maxUploadBytes 控制，此為請求防護）。 */
const IMPORT_DOCX_MAX_BYTES = 50 * 1024 * 1024;

export type ImportDocxResult =
  | { ok: true; id: string; slug: string; skippedImages: number }
  | { ok: false; error: "INVALID_FILE" | "INVALID_DOCX" | "EMPTY_DOCX" | "TOO_LARGE" };

/**
 * 單檔 Word (.docx) 匯入（M4-08，F-IE-03 子集）：
 * docx → HTML（mammoth）→ Markdown（turndown+gfm）→ 既有 markdown-to-doc → savePage 管線
 * （三欄同交易同步＋版本快照＋enqueue embedding，鐵律 5 不旁路）。
 * 圖片抽出後經 saveAttachment（白名單驗證）存為附件並改寫引用；單張被拒僅略過（同 J-02）。
 * 轉換失敗發生在建頁之前——損壞檔不產生半成品頁面。
 */
export async function importDocxPage(formData: FormData): Promise<ImportDocxResult> {
  const { user } = await requireSession();
  const file = formData.get("file");
  const spaceId = z.uuid().parse(formData.get("spaceId"));
  const parentRaw = formData.get("parentId");
  const parentId = parentRaw ? z.uuid().parse(parentRaw) : null;

  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "INVALID_FILE" };
  if (file.size > IMPORT_DOCX_MAX_BYTES) return { ok: false, error: "TOO_LARGE" };
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".docx")) return { ok: false, error: "INVALID_FILE" };

  // 轉換先於建頁：損壞/非 docx 在此擲出 → 明確錯誤、零資料列
  let conversion: Awaited<ReturnType<typeof docxToMarkdown>>;
  try {
    conversion = await docxToMarkdown(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    logger.warn({ err: error, fileName: file.name }, "docx 轉換失敗");
    return { ok: false, error: "INVALID_DOCX" };
  }
  if (!conversion.markdown.trim() && conversion.images.length === 0) {
    return { ok: false, error: "EMPTY_DOCX" };
  }
  if (conversion.warnings.length > 0) {
    logger.info({ fileName: file.name, warnings: conversion.warnings }, "docx 轉換警告");
  }

  // 先以無 resolver 建置取得標題（首個 H1 或檔名）
  const { title } = buildMarkdownImport(conversion.markdown, file.name);

  // createPage 內含 requireEditor（page.edit 授權）與 slug 配置
  const { id, slug } = await createPage({ spaceId, parentId, title });

  // 圖片 → 附件（白名單/大小驗證在 saveAttachment）；單張被拒略過、引用降級為連結
  const srcByPlaceholder = new Map<string, string>();
  let skippedImages = 0;
  for (const image of conversion.images) {
    try {
      const attachment = await saveAttachment({
        spaceId,
        pageId: id,
        uploaderId: user.id,
        fileName: imageFileName(image.index, image.contentType),
        mimeType: image.contentType,
        data: image.data,
      });
      srcByPlaceholder.set(`${DOCX_IMAGE_SCHEME}${image.index}`, `/api/files/${attachment.id}`);
    } catch (error) {
      if (error instanceof UploadValidationError) {
        skippedImages += 1;
        logger.warn({ index: image.index, code: error.code }, "docx 圖片被拒（略過）");
      } else {
        throw error;
      }
    }
  }

  const { doc } = buildMarkdownImport(conversion.markdown, file.name, {
    resolveImageSrc: (href) => srcByPlaceholder.get(href) ?? null,
  });
  await savePage({ pageId: id, expectedVersionNo: 0, content: doc });

  logger.info(
    { pageId: id, spaceId, fileName: file.name, images: conversion.images.length, skippedImages },
    "docx page imported",
  );
  return { ok: true, id, slug, skippedImages };
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
