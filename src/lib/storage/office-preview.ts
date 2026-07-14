import "server-only";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachmentPreviews, attachments } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getStorageProvider } from "@/lib/storage/provider";
import { fileExtension, OFFICE_PREVIEW_EXTENSIONS } from "@/lib/storage/validate";
import { logger } from "@/lib/logger";

/**
 * Office 附件 → 衍生 PDF 預覽（M4-12，issue #216）。
 * 轉檔走 Gotenberg（LibreOffice HTTP API，compose sidecar）；未設定
 * PREVIEW_CONVERTER_URL 時整個功能停用（附件降級為僅下載）。
 * 轉檔核心接受顯式 converterUrl 以便整合測試以假 HTTP server 驗證。
 */

export function isOfficeAttachment(fileName: string): boolean {
  return OFFICE_PREVIEW_EXTENSIONS.has(fileExtension(fileName));
}

export function isPreviewConverterConfigured(): boolean {
  return Boolean(env.PREVIEW_CONVERTER_URL);
}

/** 單次轉檔的來源檔大小上限保護（與上傳上限一致，理論上不會超出）。 */
const CONVERT_TIMEOUT_MS = 120_000;

/** upsert 預覽列狀態（updatedAt 一併刷新）。 */
async function upsertPreview(
  attachmentId: string,
  values: { status: "pending" | "ready" | "failed"; storageKey?: string | null; sizeBytes?: number | null; error?: string | null },
): Promise<void> {
  await db
    .insert(attachmentPreviews)
    .values({
      attachmentId,
      status: values.status,
      storageKey: values.storageKey ?? null,
      sizeBytes: values.sizeBytes ?? null,
      error: values.error ?? null,
    })
    .onConflictDoUpdate({
      target: attachmentPreviews.attachmentId,
      set: {
        status: values.status,
        storageKey: values.storageKey ?? null,
        sizeBytes: values.sizeBytes ?? null,
        error: values.error ?? null,
        updatedAt: sql`now()`,
      },
    });
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * 轉檔 job 核心（worker 消費 convert-attachment-preview）：讀來源檔 →
 * POST Gotenberg `/forms/libreoffice/convert` → 衍生 PDF 存 StorageProvider →
 * upsert attachment_previews。失敗記 failed＋error（route/前端據此顯示「無法預覽」）。
 * 擲錯讓 pg-boss 重試；重試耗盡後最後狀態停留在 failed。
 */
export async function convertAttachmentPreview(
  attachmentId: string,
  converterUrl: string,
): Promise<void> {
  const attachment = await db.query.attachments.findFirst({
    where: eq(attachments.id, attachmentId),
  });
  if (!attachment) {
    logger.warn({ attachmentId }, "convert-attachment-preview：附件已不存在，略過");
    return;
  }
  if (!isOfficeAttachment(attachment.fileName)) {
    logger.warn({ attachmentId, fileName: attachment.fileName }, "非 Office 附件，略過轉檔");
    return;
  }

  // 記住既有衍生檔（重轉時舊檔失去列引用，完成後回收，避免 storage 洩漏）
  const prior = await db.query.attachmentPreviews.findFirst({
    where: eq(attachmentPreviews.attachmentId, attachmentId),
  });
  await upsertPreview(attachmentId, { status: "pending" });
  const storage = getStorageProvider();

  try {
    const source = await streamToBuffer(await storage.getStream(attachment.storageKey));
    // Gotenberg 以上傳檔名的副檔名判斷來源格式；檔名淨化為固定樣式避免注入
    const form = new FormData();
    form.append(
      "files",
      new Blob([new Uint8Array(source)]),
      `source${fileExtension(attachment.fileName)}`,
    );
    // 相對解析保留 converterUrl 的 path 前綴（反向代理子路徑部署）
    const base = converterUrl.endsWith("/") ? converterUrl : `${converterUrl}/`;
    const res = await fetch(new URL("forms/libreoffice/convert", base), {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`轉檔服務回應 ${res.status}`);
    }
    const pdf = Buffer.from(await res.arrayBuffer());
    if (pdf.length === 0 || !pdf.subarray(0, 5).toString("latin1").startsWith("%PDF")) {
      throw new Error("轉檔服務未回傳有效 PDF");
    }

    const derivedKey = `preview-${randomUUID()}.pdf`;
    await storage.put(derivedKey, pdf);
    // 先寫檔再更新列；列更新失敗時回收衍生檔，不殘留無主檔案
    try {
      await upsertPreview(attachmentId, {
        status: "ready",
        storageKey: derivedKey,
        sizeBytes: pdf.length,
      });
    } catch (error) {
      await storage.delete(derivedKey).catch(() => undefined);
      throw error;
    }
    // 舊衍生檔已失去列引用（storageKey 被覆寫），此刻回收
    if (prior?.storageKey && prior.storageKey !== derivedKey) {
      await storage.delete(prior.storageKey).catch(() => undefined);
    }
    logger.info({ attachmentId, derivedKey, sizeBytes: pdf.length }, "office 附件轉 PDF 完成");
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "unknown";
    await upsertPreview(attachmentId, { status: "failed", error: message }).catch(() => undefined);
    // failed 列的 storageKey 為 null：舊衍生檔（若有）同樣失去引用，一併回收
    if (prior?.storageKey) {
      await getStorageProvider().delete(prior.storageKey).catch(() => undefined);
    }
    logger.error({ err: error, attachmentId }, "office 附件轉 PDF 失敗");
    throw error;
  }
}
