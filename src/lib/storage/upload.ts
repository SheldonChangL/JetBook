import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { attachments, type Attachment } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getStorageProvider } from "./provider";
import { fileExtension, validateUpload, type UploadValidationErrorCode } from "./validate";

/** 上傳驗證失敗（型別/大小/空檔）；code 供 route 對映 HTTP 狀態。 */
export class UploadValidationError extends Error {
  constructor(public readonly code: UploadValidationErrorCode) {
    super(code);
    this.name = "UploadValidationError";
  }
}

/** 單檔大小上限（bytes），由 env.MAX_UPLOAD_MB 換算。 */
export function maxUploadBytes(): number {
  return env.MAX_UPLOAD_MB * 1024 * 1024;
}

export interface SaveAttachmentInput {
  spaceId: string;
  /** 掛載頁面；上傳當下未掛頁面可為 null */
  pageId?: string | null;
  uploaderId: string;
  /** 原始檔名（只入 DB metadata；儲存一律用 UUID 檔名重寫） */
  fileName: string;
  mimeType: string;
  data: Buffer;
}

/**
 * 附件儲存管線（M-01）：驗證（雙白名單＋大小）→ UUID 檔名重寫 →
 * sha256 → StorageProvider 寫入 → insert attachments metadata。
 * 權限（page.edit）由呼叫端薄殼先驗——本函式不重複散寫權限邏輯。
 * DB 寫入失敗時回收已寫入的檔案，不留孤兒檔。
 */
export async function saveAttachment(input: SaveAttachmentInput): Promise<Attachment> {
  const errorCode = validateUpload({
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.data.byteLength,
    maxBytes: maxUploadBytes(),
  });
  if (errorCode) throw new UploadValidationError(errorCode);

  const storageKey = `${randomUUID()}${fileExtension(input.fileName)}`;
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const storage = getStorageProvider();

  await storage.put(storageKey, input.data);
  try {
    const [row] = await db
      .insert(attachments)
      .values({
        spaceId: input.spaceId,
        pageId: input.pageId ?? null,
        uploaderId: input.uploaderId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.data.byteLength,
        storageKey,
        sha256,
      })
      .returning();
    if (!row) throw new Error("attachments insert 未回傳資料列");
    return row;
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}
