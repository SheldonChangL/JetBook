import "server-only";
import { eq, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, pages } from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getStorageProvider } from "./provider";

/**
 * 孤兒附件回收（M-03，F-ADMIN-07）。
 *
 * 附件本體存於 StorageProvider、metadata 存 `attachments` 表。頁面編輯移除引用或
 * 頁面被刪除後，附件可能不再被任何內容引用而成為「孤兒」。本模組每日由背景 GC job
 * （worker cron，`gc-orphan-attachments`）掃描並回收：清除 storage 檔與 metadata 列，
 * 寫入稽核日誌。後台儲存用量卡片（`getStorageUsage`）亦重用此處的孤兒判定。
 *
 * 引用判定（唯一事實來源）：走訪頁面 `content`（TipTap JSON canonical）的
 * - image 節點：`attrs.src === /api/files/<attachmentId>`
 * - attachment 節點：`attrs.attachmentId`
 * 兩者即編輯器插入與閱讀渲染兩端使用的引用格式（見 image/attachment extension）。
 *
 * 回收條件（兩者皆須成立）：
 * 1. 未被任何**未刪除**頁面（`deleted_at IS NULL`）的 content 引用——軟刪／已清除頁面
 *    的內容不計入引用，故「被刪頁面的附件」同樣可成為孤兒（issue #48）。
 * 2. 建立逾寬限期（`created_at < now − graceDays`）——避免誤刪剛上傳、尚未存進頁面
 *    內容的檔案；也讓寬限期內因頁面／版本還原重新被引用者不被回收。
 *
 * 權限：本模組為純資料存取＋維運回收，僅由 worker cron 與 org admin 後台呼叫，
 * 不經一般使用者的 Server Action／Route Handler 暴露。
 */

/** 孤兒附件寬限天數：建立未逾此天數者即使未被引用也不回收。 */
export const ORPHAN_ATTACHMENT_GRACE_DAYS = 30;

/** 上傳檔案的同源下載路徑前綴（image 節點 src 以此開頭）。 */
const FILE_URL_PREFIX = "/api/files/";

/** TipTap 節點最小結構（僅取引用判定需要的欄位；未知節點型別一律忽略）。 */
interface DocNode {
  type?: string;
  attrs?: Record<string, unknown> | null;
  content?: DocNode[] | null;
}

/** 由 image 節點的 src（`/api/files/<id>`）擷取 attachmentId；非上傳來源回 null。 */
function attachmentIdFromSrc(src: unknown): string | null {
  if (typeof src !== "string" || !src.startsWith(FILE_URL_PREFIX)) return null;
  // 取前綴後、下一個 `/`、`?`、`#` 之前的片段（防未來帶查詢字串或子路徑）。
  const id = src.slice(FILE_URL_PREFIX.length).split(/[/?#]/, 1)[0];
  return id ? id : null;
}

/**
 * 遞迴走訪 TipTap JSON，收集內容引用的 attachmentId（image src ＋ attachment 節點）。
 * 純函式、無 IO，可單元測試；`acc` 供多頁掃描累積同一集合。
 */
export function collectReferencedAttachmentIds(
  doc: unknown,
  acc: Set<string> = new Set<string>(),
): Set<string> {
  if (!doc || typeof doc !== "object") return acc;
  const node = doc as DocNode;
  if (node.type === "image") {
    const id = attachmentIdFromSrc(node.attrs?.src);
    if (id) acc.add(id);
  } else if (node.type === "attachment") {
    const id = node.attrs?.attachmentId;
    if (typeof id === "string" && id) acc.add(id);
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectReferencedAttachmentIds(child, acc);
  }
  return acc;
}

/**
 * 掃描所有未刪除頁面的 content，回傳全站被引用的 attachmentId 集合。
 * 軟刪頁面（`deleted_at` 非 null）不計入——其附件視為未被引用。
 */
export async function getReferencedAttachmentIds(): Promise<Set<string>> {
  const rows = await db
    .select({ content: pages.content })
    .from(pages)
    .where(isNull(pages.deletedAt));
  const acc = new Set<string>();
  for (const row of rows) {
    if (row.content) collectReferencedAttachmentIds(row.content, acc);
  }
  return acc;
}

/** 孤兒附件回收所需的最小欄位。 */
export interface OrphanAttachment {
  id: string;
  spaceId: string;
  storageKey: string;
  fileName: string;
  sizeBytes: number;
}

/**
 * 找出孤兒附件：建立逾寬限期且未被任何未刪除頁面 content 引用者。
 * 先取候選（逾寬限期）再取引用集合，讓引用集合為兩次查詢中較新的一份，
 * 縮小「掃描期間新增引用」的競態窗（背景每日執行、寬限期達 30 天，殘餘競態可忽略）。
 */
export async function findOrphanAttachments(
  graceDays: number = ORPHAN_ATTACHMENT_GRACE_DAYS,
): Promise<OrphanAttachment[]> {
  const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);
  const candidates = await db
    .select({
      id: attachments.id,
      spaceId: attachments.spaceId,
      storageKey: attachments.storageKey,
      fileName: attachments.fileName,
      sizeBytes: attachments.sizeBytes,
    })
    .from(attachments)
    .where(lt(attachments.createdAt, cutoff));
  if (candidates.length === 0) return [];
  const referenced = await getReferencedAttachmentIds();
  return candidates.filter((att) => !referenced.has(att.id));
}

/** GC 執行結果摘要（寫入 log／稽核）。 */
export interface OrphanGcResult {
  /** 實際回收（storage 檔＋DB 列）的附件數 */
  deleted: number;
  /** 回收釋放的位元組數 */
  freedBytes: number;
}

/**
 * 回收孤兒附件（worker cron，`gc-orphan-attachments`）：逐筆刪 storage 檔（冪等）後刪
 * metadata 列；單筆失敗僅記錄並續處理下一筆（不讓一顆壞檔阻塞整批）。回收後寫一筆稽核。
 */
export async function collectOrphanAttachments(
  graceDays: number = ORPHAN_ATTACHMENT_GRACE_DAYS,
): Promise<OrphanGcResult> {
  const orphans = await findOrphanAttachments(graceDays);
  if (orphans.length === 0) return { deleted: 0, freedBytes: 0 };

  const storage = getStorageProvider();
  const deletedIds: string[] = [];
  let freedBytes = 0;

  for (const orphan of orphans) {
    try {
      // 先刪實體檔（不存在視為成功，冪等）再刪 metadata 列：
      // 若列刪除失敗，下一輪仍會重新判定回收，不致殘留「有列無檔」的可下載壞附件。
      await storage.delete(orphan.storageKey);
      await db.delete(attachments).where(eq(attachments.id, orphan.id));
      deletedIds.push(orphan.id);
      freedBytes += orphan.sizeBytes;
    } catch (error) {
      logger.error(
        { err: error, attachmentId: orphan.id, storageKey: orphan.storageKey },
        "孤兒附件回收失敗（略過該筆，續處理）",
      );
    }
  }

  const deleted = deletedIds.length;
  if (deleted > 0) {
    await writeAudit({
      action: "attachment.gc_orphan",
      targetType: "attachment",
      metadata: {
        deletedCount: deleted,
        freedBytes,
        graceDays,
        // 只留樣本，避免大批回收讓稽核 metadata 無限膨脹。
        attachmentIds: deletedIds.slice(0, 100),
      },
    });
    logger.info({ deleted, freedBytes, graceDays }, "orphan attachments collected");
  }
  return { deleted, freedBytes };
}
