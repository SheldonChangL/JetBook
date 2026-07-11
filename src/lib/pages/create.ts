import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, type Db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { positionBetween } from "@/lib/pages/position";
import { reclaimSlug, uniquePageSlug } from "@/lib/pages/slug";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

/** 建頁預設標題（與 createPage 薄殼一致）。 */
export const DEFAULT_PAGE_TITLE = "未命名頁面";

/**
 * 取得某父節點下最後一個 position（供新節點接在末尾）。
 * fractional index 為 base-62 位元組序鍵：必須 COLLATE "C" 排序（C-04 修正）。
 */
export async function lastChildPosition(
  client: DbOrTx,
  spaceId: string,
  parentId: string | null,
): Promise<string | null> {
  const rows = await client
    .select({ position: pages.position })
    .from(pages)
    .where(
      and(
        eq(pages.spaceId, spaceId),
        parentId === null ? isNull(pages.parentId) : eq(pages.parentId, parentId),
        isNull(pages.deletedAt),
      ),
    )
    .orderBy(desc(sql`${pages.position} COLLATE "C"`))
    .limit(1);
  return rows[0]?.position ?? null;
}

export interface CreatePageInput {
  spaceId: string;
  /** 父節點；null＝根層 */
  parentId: string | null;
  title: string;
  /** 建立者（created_by/updated_by） */
  userId: string;
}

/**
 * 建立頁面核心（C-02）：於呼叫端交易內配置唯一 slug、末尾 position、插入頁面列，
 * 並清除同名舊 slug 歷史（避免陳舊 301）。回傳建立的頁面列。
 *
 * `createPage` 薄殼（Server Action）與匯入 worker（無 session）皆呼叫本函式，
 * 確保建頁邏輯單一來源。權限與 session 由呼叫端薄殼先行驗證。
 * slug／position 皆於同一交易內計算（client: tx），批次連續建頁時能看見前一頁已提交結果。
 */
export async function createPageInTx(tx: Tx, input: CreatePageInput): Promise<typeof pages.$inferSelect> {
  const title = input.title.trim() || DEFAULT_PAGE_TITLE;
  const slug = await uniquePageSlug(input.spaceId, title, { client: tx });
  const last = await lastChildPosition(tx, input.spaceId, input.parentId);
  const position = positionBetween(last, null);

  const [created] = await tx
    .insert(pages)
    .values({
      spaceId: input.spaceId,
      parentId: input.parentId,
      title,
      slug,
      position,
      createdBy: input.userId,
      updatedBy: input.userId,
    })
    .returning();
  if (!created) throw new Error("page 建立失敗");
  // 新頁佔用此 slug → 清掉指向他頁的同名舊 slug 歷史（避免陳舊 301）
  await reclaimSlug(tx, input.spaceId, slug);
  return created;
}

/** db 交易封裝版（供不需與其他寫入同交易的呼叫端；createPage 薄殼用）。 */
export async function createPageRecord(input: CreatePageInput): Promise<typeof pages.$inferSelect> {
  return db.transaction((tx) => createPageInTx(tx, input));
}
