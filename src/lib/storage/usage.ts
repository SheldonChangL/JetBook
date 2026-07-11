import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, spaces } from "@/lib/db/schema";
import { findOrphanAttachments } from "./gc";

/**
 * 附件儲存用量統計（M-03，F-ADMIN-07）。供後台 /admin/system 儲存用量卡片顯示
 * 全站與各 Space 的附件數量／儲存大小，以及孤兒待回收數（重用 gc 的孤兒判定）。
 * 純唯讀彙總；權限由呼叫端（org admin 後台頁）薄殼先驗。
 */

/** 單一 Space 的附件用量。 */
export interface SpaceStorageUsage {
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  count: number;
  bytes: number;
}

/** 全站附件儲存用量彙總。 */
export interface StorageUsage {
  /** 附件總數（含孤兒） */
  totalCount: number;
  /** 附件總大小（bytes，含孤兒） */
  totalBytes: number;
  /** 孤兒待回收數（未被引用且逾寬限期） */
  orphanCount: number;
  /** 孤兒待回收大小（bytes） */
  orphanBytes: number;
  /** 各 Space 用量（僅列有附件者，依大小遞減） */
  perSpace: SpaceStorageUsage[];
}

/**
 * 取得全站附件儲存用量。`sum(bigint)` 於 pg 驅動回傳字串，統一以 Number() 轉數值
 * （內部 KM 規模不致逾越 JS 安全整數上限）。
 */
export async function getStorageUsage(): Promise<StorageUsage> {
  const [totals] = await db
    .select({
      count: sql<number>`count(*)::int`,
      bytes: sql<string>`coalesce(sum(${attachments.sizeBytes}), 0)`,
    })
    .from(attachments);

  const perSpaceRows = await db
    .select({
      spaceId: spaces.id,
      spaceName: spaces.name,
      spaceSlug: spaces.slug,
      count: sql<number>`count(${attachments.id})::int`,
      bytes: sql<string>`coalesce(sum(${attachments.sizeBytes}), 0)`,
    })
    .from(spaces)
    .innerJoin(attachments, eq(attachments.spaceId, spaces.id))
    .groupBy(spaces.id, spaces.name, spaces.slug)
    .orderBy(sql`coalesce(sum(${attachments.sizeBytes}), 0) DESC`);

  const orphans = await findOrphanAttachments();
  const orphanBytes = orphans.reduce((sum, orphan) => sum + orphan.sizeBytes, 0);

  return {
    totalCount: Number(totals?.count ?? 0),
    totalBytes: Number(totals?.bytes ?? 0),
    orphanCount: orphans.length,
    orphanBytes,
    perSpace: perSpaceRows.map((row) => ({
      spaceId: row.spaceId,
      spaceName: row.spaceName,
      spaceSlug: row.spaceSlug,
      count: Number(row.count),
      bytes: Number(row.bytes),
    })),
  };
}
