import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { attachmentPreviews, attachments } from "@/lib/db/schema";
import { can, type Actor } from "@/lib/authz/permission";
import { triggerConvertAttachmentPreview } from "@/lib/jobs/queue";
import {
  isOfficeAttachment,
  isPreviewConverterConfigured,
} from "@/lib/storage/office-preview";
import { fileExtension } from "@/lib/storage/validate";

/**
 * 附件線上預覽的決策層（M4-11 PDF／M4-12 Office 衍生 PDF，issue #215/#216）。
 * route 薄殼只負責 session 與 streaming；「哪些附件允許 inline、串哪個檔」集中在此，可整合測試。
 *
 * 安全邊界（F-SEC-08）：下載端點刻意一律 `Content-Disposition: attachment`（防 HTML/SVG
 * 同源 XSS）。預覽端點只回 PDF 內容 inline（原生 PDF 或 Office 轉出的衍生 PDF）——
 * application/pdf 由瀏覽器內建檢視器渲染、不執行同源 script，其餘一律 404（不洩漏存在性）。
 */
export type AttachmentPreviewResult =
  /** 可預覽：串流此 storageKey（原生 PDF 或衍生 PDF） */
  | { ok: true; storageKey: string; fileName: string; sizeBytes: number | null }
  /** Office 轉檔中（202）：前端顯示「轉換中」並輪詢 */
  | { ok: false; status: 202 }
  | { ok: false; status: 403 | 404 };

export async function resolveAttachmentPreview(
  user: Actor,
  attachmentId: string,
  /** 測試注入用；預設讀 env（PREVIEW_CONVERTER_URL） */
  opts: { converterConfigured?: boolean } = {},
): Promise<AttachmentPreviewResult> {
  if (!z.uuid().safeParse(attachmentId).success) return { ok: false, status: 404 };

  const attachment = await db.query.attachments.findFirst({
    where: eq(attachments.id, attachmentId),
  });
  if (!attachment) return { ok: false, status: 404 };

  const isPdf =
    fileExtension(attachment.fileName) === ".pdf" &&
    attachment.mimeType.toLowerCase() === "application/pdf";
  const converterConfigured = opts.converterConfigured ?? isPreviewConverterConfigured();
  const isOffice = isOfficeAttachment(attachment.fileName) && converterConfigured;
  // 非可預覽類型（含轉檔服務未設定的 Office 檔）一律 404，不洩漏存在性
  if (!isPdf && !isOffice) return { ok: false, status: 404 };

  // 權限與下載端點一致：附件所屬 space 的 page.read（403 與 /api/files/[id] 同模型）
  if (!(await can(user, "page.read", { type: "page", spaceId: attachment.spaceId }))) {
    return { ok: false, status: 403 };
  }

  if (isPdf) {
    return {
      ok: true,
      storageKey: attachment.storageKey,
      fileName: attachment.fileName,
      sizeBytes: attachment.sizeBytes,
    };
  }

  // Office：查衍生 PDF 狀態
  const preview = await db.query.attachmentPreviews.findFirst({
    where: eq(attachmentPreviews.attachmentId, attachment.id),
  });
  if (!preview) {
    // 功能啟用前上傳的既有附件：lazy 補排轉檔（singletonKey 防重複），回 202 供輪詢；
    // enqueue 失敗（佇列異常）誠實回 404，不讓前端輪詢一個不存在的 job
    const enqueued = await triggerConvertAttachmentPreview(attachment.id);
    return { ok: false, status: enqueued ? 202 : 404 };
  }
  if (preview.status === "pending") return { ok: false, status: 202 };
  if (preview.status === "ready" && preview.storageKey) {
    return {
      ok: true,
      storageKey: preview.storageKey,
      fileName: `${attachment.fileName}.pdf`,
      sizeBytes: preview.sizeBytes,
    };
  }
  // failed：轉檔服務暫時故障（如 Gotenberg 重啟期間重試耗盡）不該讓附件永久無法預覽——
  // 失敗已逾冷卻期時 lazy 重排一次（singletonKey 防重複），否則 404 引導下載
  const FAILED_RETRY_COOLDOWN_MS = 10 * 60 * 1000;
  if (
    preview.status === "failed" &&
    Date.now() - preview.updatedAt.getTime() > FAILED_RETRY_COOLDOWN_MS
  ) {
    const enqueued = await triggerConvertAttachmentPreview(attachment.id);
    if (enqueued) return { ok: false, status: 202 };
  }
  return { ok: false, status: 404 };
}
