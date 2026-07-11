import "server-only";
import type { Readable } from "node:stream";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isEmbeddingConfigured } from "@/lib/llm";
import { createPageInTx } from "@/lib/pages/create";
import { writePageContentTx } from "@/lib/pages/content-write";
import { buildMarkdownImport } from "@/lib/content/import-markdown";
import {
  buildImportPlan,
  inferImageMime,
  parseImportZip,
  resolveImageRefPath,
  ZipImportError,
  type ImportTreeNode,
} from "@/lib/content/import-zip";
import { getStorageProvider } from "@/lib/storage/provider";
import { saveAttachment, UploadValidationError } from "@/lib/storage/upload";
import { enqueueEmbedPage, type ImportZipJob, type ImportZipProgress } from "./queue";

/**
 * Zip 批次匯入 worker handler（J-02）。orchestration：
 * 1. 自 StorageProvider 讀回暫存 zip → 解壓＋安全防護（parseImportZip）。
 * 2. 規劃頁面樹（buildImportPlan）；上傳圖片 → 建立「zip 路徑 → 附件 id」對照。
 * 3. DFS 走訪頁面樹：資料夾＝父頁、.md 走既有儲存管線建頁（createPageInTx +
 *    writePageContentTx，架構鐵律 #5 不旁路），圖片引用改寫為 `/api/files/<id>`。
 * 4. 進度寫入 job output（best-effort）；結束刪除暫存 zip。
 *
 * 權限於 enqueue 時（Route Handler 薄殼）已驗 page.edit——worker 據 payload.userId 建頁，
 * 不重複散寫權限邏輯。本函式**不擲出**：預期／非預期錯誤皆轉為 phase=failed 報告，
 * 供 UI 輪詢呈現明確錯誤。
 */

export interface RunImportZipOptions {
  /** 進度回呼（best-effort；worker 端寫入 job output）。 */
  onProgress?: (progress: ImportZipProgress) => Promise<void> | void;
}

/** 每處理幾頁回報一次進度（節流 DB 更新）。 */
const PROGRESS_EVERY = 5;

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** 觸發頁面嵌入索引（fire-and-forget，未設定 embedding 時略過；絕不阻塞匯入）。 */
async function triggerEmbed(pageId: string): Promise<void> {
  if (!isEmbeddingConfigured()) return;
  try {
    await enqueueEmbedPage(pageId);
  } catch (error) {
    logger.error({ err: error, pageId }, "匯入頁 enqueue embed 失敗（不阻塞匯入）");
  }
}

export async function runImportZip(
  data: ImportZipJob,
  options: RunImportZipOptions = {},
): Promise<ImportZipProgress> {
  const storage = getStorageProvider();
  const progress: ImportZipProgress = {
    phase: "unzipping",
    processed: 0,
    total: 0,
    createdPages: 0,
    uploadedImages: 0,
    rewrittenImageLinks: 0,
    skipped: [],
  };

  const report = async () => {
    if (options.onProgress) await options.onProgress({ ...progress, skipped: [...progress.skipped] });
  };

  try {
    // 1. 讀回 zip 並解壓（含安全防護）。
    const zipStream = await storage.getStream(data.storageKey);
    const zipBuffer = await streamToBuffer(zipStream);
    const files = parseImportZip(new Uint8Array(zipBuffer));
    const plan = buildImportPlan(files);

    progress.total = plan.pageCount;
    progress.skipped = plan.skipped.map((s) => ({ path: s.path, reason: s.reason }));
    progress.phase = "importing";
    await report();

    // 2. 上傳圖片並建立「zip 路徑 → 附件 id」對照。
    const imageIdByPath = new Map<string, string>();
    for (const image of plan.images) {
      const mimeType = inferImageMime(image.fileName);
      if (!mimeType) continue; // 理論上不會發生（已依副檔名篩選）
      try {
        const attachment = await saveAttachment({
          spaceId: data.spaceId,
          pageId: null,
          uploaderId: data.userId,
          fileName: image.fileName,
          mimeType,
          data: Buffer.from(image.bytes),
        });
        imageIdByPath.set(image.path, attachment.id);
        progress.uploadedImages += 1;
      } catch (error) {
        // 單張圖片失敗（如超過附件大小上限）不中止整批：記錄後略過，引用維持原樣。
        if (error instanceof UploadValidationError) {
          logger.warn({ path: image.path, code: error.code }, "匯入圖片被拒（略過）");
          progress.skipped.push({ path: image.path, reason: `image-${error.code}` });
        } else {
          throw error;
        }
      }
    }

    // 3. DFS 建頁（資料夾＝父頁；.md 走既有儲存管線）。
    const createNode = async (node: ImportTreeNode, parentId: string | null): Promise<void> => {
      let pageId: string;

      if (node.kind === "folder") {
        const page = await db.transaction((tx) =>
          createPageInTx(tx, {
            spaceId: data.spaceId,
            parentId,
            title: node.title,
            userId: data.userId,
          }),
        );
        pageId = page.id;
        progress.createdPages += 1;
      } else {
        const baseDir = node.path.split("/").slice(0, -1).join("/");
        let hits = 0;
        const { title, doc } = buildMarkdownImport(node.markdown ?? "", node.fileName ?? node.path, {
          resolveImageSrc: (href) => {
            const key = resolveImageRefPath(baseDir, href);
            if (!key) return null;
            const id = imageIdByPath.get(key);
            if (!id) return null;
            hits += 1;
            return `/api/files/${id}`;
          },
        });
        const page = await db.transaction(async (tx) => {
          const created = await createPageInTx(tx, {
            spaceId: data.spaceId,
            parentId,
            title,
            userId: data.userId,
          });
          // 新頁 currentVersionNo=0：以樂觀鎖初值走一次內容管線（三欄同交易同步 + 版本快照）。
          await writePageContentTx(tx, {
            pageId: created.id,
            pageTitle: created.title,
            expectedVersionNo: 0,
            content: doc,
            userId: data.userId,
          });
          return created;
        });
        pageId = page.id;
        progress.createdPages += 1;
        progress.rewrittenImageLinks += hits;
        await triggerEmbed(pageId);
      }

      progress.processed += 1;
      if (progress.processed % PROGRESS_EVERY === 0) await report();

      for (const child of node.children) await createNode(child, pageId);
    };

    for (const root of plan.tree) await createNode(root, data.parentId);

    progress.phase = "completed";
    await report();
    logger.info(
      {
        spaceId: data.spaceId,
        fileName: data.fileName,
        createdPages: progress.createdPages,
        uploadedImages: progress.uploadedImages,
        rewrittenImageLinks: progress.rewrittenImageLinks,
      },
      "zip 匯入完成",
    );
    return progress;
  } catch (error) {
    progress.phase = "failed";
    if (error instanceof ZipImportError) {
      progress.errorCode = error.code;
      progress.errorMessage = error.message;
      logger.warn({ code: error.code, fileName: data.fileName }, "zip 匯入被拒");
    } else {
      progress.errorCode = "UNKNOWN";
      progress.errorMessage = "匯入處理發生非預期錯誤";
      logger.error({ err: error, fileName: data.fileName }, "zip 匯入非預期錯誤");
    }
    await report();
    return progress;
  } finally {
    // 暫存 zip 用完即刪（web／worker stateless；不留孤兒檔）。
    await storage.delete(data.storageKey).catch((error) => {
      logger.warn({ err: error, storageKey: data.storageKey }, "刪除暫存 zip 失敗");
    });
  }
}
