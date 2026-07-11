import "server-only";
import type { Readable } from "node:stream";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { db } from "@/lib/db";
import { attachments, pages } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { getStorageProvider } from "@/lib/storage/provider";
import {
  assetZipPath,
  buildExportForest,
  collectAttachmentIds,
  layoutExport,
  pageFileMarkdown,
  relativeAssetPath,
  rewriteAttachmentLinks,
  sanitizeSegment,
  type ExportPage,
} from "@/lib/content/export-markdown";
import type { ExportSpaceJob, ExportSpaceProgress } from "./queue";

/**
 * 整個 Space Markdown 匯出 worker handler（J-03，F-IE-02）。orchestration：
 * 1. 讀取空間未刪除頁面（依 position 排序）→ 組頁面樹 → 規劃 zip 目錄佈局（純規劃層）。
 * 2. 收集所有頁面 content_md 內的站內附件 id → 一次查回本空間附件 → 串流位元組放入
 *    `assets/<id>.<ext>`，並建立 id→zip 路徑對照。
 * 3. 逐頁組裝 Markdown（`# 標題` + content_md，附件連結改寫為相對路徑）→ zipSync 打包。
 * 4. zip 暫存至 StorageProvider（下載 route 權限保護串流）；回傳含 storageKey 的最終報告。
 *
 * 權限於 enqueue 時（Route Handler 薄殼）已驗 space.manage——worker 據 payload 讀頁打包，
 * 不重複散寫權限邏輯。本函式**不擲出**：預期／非預期錯誤皆轉為 phase=failed 報告，供 UI 輪詢。
 */

/** 匯出暫存檔的 storage 前綴（供逾期清理 list）。 */
export const EXPORT_STORAGE_PREFIX = "export/";

/** 匯出暫存檔的 storage key（以 jobId 命名，下載 route 由 job output 取得）。 */
export function exportStorageKey(jobId: string): string {
  return `${EXPORT_STORAGE_PREFIX}${jobId}.zip`;
}

/** 匯出暫存檔保留時間（逾時由 purge cron 清除）。 */
export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

export interface RunExportSpaceOptions {
  /** pg-boss job id（決定暫存 zip 的 storage key）。 */
  jobId: string;
  /** 進度回呼（best-effort；worker 端寫入 job output）。 */
  onProgress?: (progress: ExportSpaceProgress) => Promise<void> | void;
}

/** 每處理幾頁回報一次進度（節流 DB 更新）。 */
const PROGRESS_EVERY = 10;

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

export async function runExportSpace(
  data: ExportSpaceJob,
  options: RunExportSpaceOptions,
): Promise<ExportSpaceProgress> {
  const storage = getStorageProvider();
  const progress: ExportSpaceProgress = {
    phase: "collecting",
    processed: 0,
    total: 0,
    exportedPages: 0,
    includedAssets: 0,
  };
  const report = async () => {
    if (options.onProgress) await options.onProgress({ ...progress });
  };

  try {
    // 1. 讀取空間未刪除頁面（position COLLATE "C"：fractional index 位元組序）。
    const rows: ExportPage[] = await db
      .select({
        id: pages.id,
        parentId: pages.parentId,
        title: pages.title,
        contentMd: pages.contentMd,
      })
      .from(pages)
      .where(and(eq(pages.spaceId, data.spaceId), isNull(pages.deletedAt)))
      .orderBy(asc(sql`${pages.position} COLLATE "C"`));

    progress.total = rows.length;
    await report();

    const forest = buildExportForest(rows);
    const fileEntries = layoutExport(forest);

    // 2. 收集所有站內附件 id → 一次查回本空間附件（跨空間引用一律排除，不外洩）。
    const referencedIds = new Set<string>();
    for (const row of rows) {
      for (const id of collectAttachmentIds(row.contentMd)) referencedIds.add(id);
    }

    const zipFiles: Record<string, Uint8Array> = {};
    /** attachmentId（小寫）→ zip 內 assets 路徑（僅本空間、實際存在者）。 */
    const assetPathById = new Map<string, string>();

    if (referencedIds.size > 0) {
      const atts = await db
        .select({
          id: attachments.id,
          fileName: attachments.fileName,
          storageKey: attachments.storageKey,
        })
        .from(attachments)
        .where(
          and(eq(attachments.spaceId, data.spaceId), inArray(attachments.id, [...referencedIds])),
        );

      progress.phase = "packaging";
      await report();

      for (const att of atts) {
        const zipPath = assetZipPath(att.id, att.fileName);
        try {
          const stream = await storage.getStream(att.storageKey);
          const buf = await streamToBuffer(stream);
          zipFiles[zipPath] = new Uint8Array(buf);
          assetPathById.set(att.id.toLowerCase(), zipPath);
          progress.includedAssets += 1;
        } catch (error) {
          // 附件 metadata 存在但檔案本體遺失：略過該資產，連結維持原樣，不中止整批匯出。
          logger.warn(
            { err: error, attachmentId: att.id, spaceId: data.spaceId },
            "匯出附件本體遺失（略過）",
          );
        }
      }
    }

    // 3. 逐頁組裝 Markdown（標題化 H1 + 附件連結改寫為相對路徑）→ 收進 zip。
    progress.phase = "packaging";
    for (const entry of fileEntries) {
      const rewritten = rewriteAttachmentLinks(entry.page.contentMd, (id) => {
        const zipPath = assetPathById.get(id);
        return zipPath ? relativeAssetPath(entry.dir, zipPath) : null;
      });
      const md = pageFileMarkdown(entry.page.title, rewritten);
      zipFiles[entry.path] = strToU8(md);
      progress.exportedPages += 1;
      progress.processed += 1;
      if (progress.processed % PROGRESS_EVERY === 0) await report();
    }

    // 4. 打包並暫存 zip（下載 route 權限保護串流）。
    const zipped = zipSync(zipFiles);
    const storageKey = exportStorageKey(options.jobId);
    await storage.put(storageKey, Buffer.from(zipped));

    const baseName = sanitizeSegment(data.spaceName) || "space";
    progress.phase = "completed";
    progress.storageKey = storageKey;
    progress.fileName = `${baseName}.zip`;
    progress.sizeBytes = zipped.byteLength;
    await report();
    logger.info(
      {
        spaceId: data.spaceId,
        exportedPages: progress.exportedPages,
        includedAssets: progress.includedAssets,
        sizeBytes: progress.sizeBytes,
      },
      "space 匯出完成",
    );
    return progress;
  } catch (error) {
    progress.phase = "failed";
    progress.errorCode = "UNKNOWN";
    progress.errorMessage = "匯出處理發生非預期錯誤";
    logger.error({ err: error, spaceId: data.spaceId }, "space 匯出非預期錯誤");
    await report();
    return progress;
  }
}

/**
 * 清除逾期匯出暫存檔（J-03，cron）：刪除 EXPORT_STORAGE_PREFIX 下修改時間早於 maxAgeMs 者。
 * 回傳刪除數。web／worker stateless——暫存匯出檔用完（或逾期）即刪，不留孤兒檔。
 */
export async function purgeExpiredExports(maxAgeMs: number = EXPORT_TTL_MS): Promise<number> {
  const storage = getStorageProvider();
  const objects = await storage.list(EXPORT_STORAGE_PREFIX);
  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;
  for (const obj of objects) {
    if (obj.modifiedMs >= cutoff) continue;
    try {
      await storage.delete(obj.key);
      deleted += 1;
    } catch (error) {
      logger.warn({ err: error, key: obj.key }, "刪除逾期匯出檔失敗");
    }
  }
  return deleted;
}
