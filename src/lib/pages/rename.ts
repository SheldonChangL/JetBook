import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { recordSlugHistory, reclaimSlug, uniquePageSlug } from "@/lib/pages/slug";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface RenamePageTxInput {
  /** 改名對象（交易內讀取的 fresh 列） */
  page: { id: string; spaceId: string; slug: string };
  title: string;
  userId: string;
  /**
   * 樂觀鎖守衛（M4-13 API 路徑）：帶入時 UPDATE 附 `current_version_no = guard` 條件，
   * 原子擋掉「版本比對後、更新前」被並發寫入穿越的時窗；不符回 null（呼叫端映射 CONFLICT）。
   * web 互動路徑（renamePage action）不帶——改名不參與版本樂觀鎖，維持既有語意。
   */
  guardVersionNo?: number;
}

/**
 * 改名核心（唯一實作，web renamePage 與 API apiUpdatePage 共用）：
 * uniquePageSlug 排除自身防自撞尾碼 → slug 變更時舊 slug 進 301 歷史（G1）並
 * 回收新 slug 的陳舊指向 → 同交易更新 title/slug。改名不遞增版本、不留版本快照。
 */
export async function renamePageTx(
  tx: Tx,
  input: RenamePageTxInput,
): Promise<{ slug: string } | null> {
  const slug = await uniquePageSlug(input.page.spaceId, input.title, {
    excludePageId: input.page.id,
    client: tx,
  });
  if (slug !== input.page.slug) {
    await recordSlugHistory(tx, input.page.spaceId, input.page.slug, input.page.id);
    await reclaimSlug(tx, input.page.spaceId, slug);
  }
  const where =
    input.guardVersionNo !== undefined
      ? and(eq(pages.id, input.page.id), eq(pages.currentVersionNo, input.guardVersionNo))
      : eq(pages.id, input.page.id);
  const updated = await tx
    .update(pages)
    .set({ title: input.title, slug, updatedBy: input.userId, updatedAt: new Date() })
    .where(where)
    .returning({ id: pages.id });
  // 0 列＝版本守衛不符（或頁面已消失）；歷史寫入隨交易回滾
  if (updated.length === 0) return null;
  return { slug };
}
