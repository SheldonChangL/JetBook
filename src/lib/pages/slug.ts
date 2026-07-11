import "server-only";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db, type Db } from "@/lib/db";
import { pages, pageSlugHistory } from "@/lib/db/schema";

/** slug 最大長度（超出截斷；衝突尾碼另計）。 */
const SLUG_MAX_LEN = 48;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

/**
 * 標題 → slug（C-05）：
 * - 拉丁字母／數字標題 → 可讀 kebab slug（小寫、非字母數字轉「-」、截斷）。
 * - 純中文／純符號標題（slug 中無 a-z0-9）→ 隨機短 ID `p-xxxxxxxx`，
 *   避免 URL 出現 percent-encoded 非 ASCII（issue #23「中文標題→可讀 slug/短 ID」）。
 */
export function slugifyTitle(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return base && /[a-z0-9]/.test(base) ? base.slice(0, SLUG_MAX_LEN) : `p-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * 產生 space 內唯一 slug（C-05 衝突尾碼）。
 *
 * 衝突偵測涵蓋**全部**頁面（含軟刪除），因為 `ux_pages_space_slug` 是
 * `(space_id, slug)` 的完整唯一索引（非 partial）：軟刪除頁仍佔用 slug
 * （支援日後還原不撞名），故不可將其排除，否則 insert 會違反唯一索引。
 *
 * `excludePageId`：改名時排除頁面自身，避免與自己現行 slug 自撞而平白產生 `-2` 尾碼。
 */
export async function uniquePageSlug(
  spaceId: string,
  title: string,
  opts: { excludePageId?: string; client?: DbOrTx } = {},
): Promise<string> {
  const client = opts.client ?? db;
  const base = slugifyTitle(title);
  const notSelf = opts.excludePageId ? ne(pages.id, opts.excludePageId) : undefined;
  let candidate = base;
  for (let i = 2; ; i += 1) {
    const existing = await client.query.pages.findFirst({
      where: and(eq(pages.spaceId, spaceId), eq(pages.slug, candidate), notSelf),
    });
    if (!existing) return candidate;
    candidate = `${base}-${i}`;
  }
}

/**
 * 改名時把舊 slug 記入歷史供 301（G1/F-PAGE-03）。
 * 以 upsert 自癒既有陳舊指向：同一舊 slug 只保留最後一位持有者。
 */
export async function recordSlugHistory(
  tx: DbOrTx,
  spaceId: string,
  oldSlug: string,
  pageId: string,
): Promise<void> {
  await tx
    .insert(pageSlugHistory)
    .values({ spaceId, oldSlug, pageId })
    .onConflictDoUpdate({
      target: [pageSlugHistory.spaceId, pageSlugHistory.oldSlug],
      set: { pageId, createdAt: new Date() },
    });
}

/**
 * slug 成為某現行頁面所有（新建頁或改名後）時，清除同名的舊 slug 歷史。
 * 維持不變式「歷史表的 old_slug 不得等於任一現行頁面的 slug」，
 * 避免現行 slug 被陳舊 301 指向他頁（issue #23「slug 歷史撞現行 slug 清理」）。
 */
export async function reclaimSlug(tx: DbOrTx, spaceId: string, slug: string): Promise<void> {
  await tx
    .delete(pageSlugHistory)
    .where(and(eq(pageSlugHistory.spaceId, spaceId), eq(pageSlugHistory.oldSlug, slug)));
}

type PageRow = typeof pages.$inferSelect;

export type ResolveResult =
  | { page: PageRow; redirectToSlug: null }
  | { page: null; redirectToSlug: string }
  | { page: null; redirectToSlug: null };

/**
 * 依 slug 解析頁面（閱讀頁 resolver，G-02/G1）：
 * 1. 先查現行 slug 的未刪除頁面 → 直接回傳。
 * 2. 查不到 → 查 slug 歷史，若對應頁面仍存在（未刪除）→ 回傳其現行 slug 供 301 導向。
 * 3. 都無 → `{ page: null, redirectToSlug: null }`（呼叫端 404）。
 *
 * 權限判斷不在此（由呼叫端經 lib/authz 檢查），此函式僅負責 slug→page 對應。
 */
export async function resolvePageBySlug(
  spaceId: string,
  slug: string,
  client: DbOrTx = db,
): Promise<ResolveResult> {
  const page = await client.query.pages.findFirst({
    where: and(eq(pages.spaceId, spaceId), eq(pages.slug, slug), isNull(pages.deletedAt)),
  });
  if (page) return { page, redirectToSlug: null };

  const history = await client.query.pageSlugHistory.findFirst({
    where: and(eq(pageSlugHistory.spaceId, spaceId), eq(pageSlugHistory.oldSlug, slug)),
  });
  if (history) {
    const current = await client.query.pages.findFirst({
      where: and(eq(pages.id, history.pageId), isNull(pages.deletedAt)),
    });
    if (current) return { page: null, redirectToSlug: current.slug };
  }
  return { page: null, redirectToSlug: null };
}
