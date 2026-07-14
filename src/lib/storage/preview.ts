import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { attachments, type Attachment } from "@/lib/db/schema";
import { can, type Actor } from "@/lib/authz/permission";
import { fileExtension } from "@/lib/storage/validate";

/**
 * PDF 附件線上預覽的決策層（M4-11，issue #215）。
 * route 薄殼只負責 session 與 streaming；「哪些附件允許 inline」集中在此，可整合測試。
 *
 * 安全邊界（F-SEC-08）：下載端點刻意一律 `Content-Disposition: attachment`（防 HTML/SVG
 * 同源 XSS）。預覽端點只對**副檔名與 MIME 皆為 PDF** 的附件回 inline——application/pdf
 * 由瀏覽器內建檢視器渲染、不執行同源 script，其餘類型一律 404（不洩漏存在性）。
 */
export type PdfPreviewResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; status: 403 | 404 };

export async function resolvePdfPreview(
  user: Actor,
  attachmentId: string,
): Promise<PdfPreviewResult> {
  if (!z.uuid().safeParse(attachmentId).success) return { ok: false, status: 404 };

  const attachment = await db.query.attachments.findFirst({
    where: eq(attachments.id, attachmentId),
  });
  if (!attachment) return { ok: false, status: 404 };

  // 僅 PDF 可預覽：副檔名與 MIME 雙重比對（與上傳雙白名單同精神），其餘一律 404
  if (
    fileExtension(attachment.fileName) !== ".pdf" ||
    attachment.mimeType.toLowerCase() !== "application/pdf"
  ) {
    return { ok: false, status: 404 };
  }

  // 權限與下載端點一致：附件所屬 space 的 page.read（403 與 /api/files/[id] 同模型）
  if (!(await can(user, "page.read", { type: "page", spaceId: attachment.spaceId }))) {
    return { ok: false, status: 403 };
  }
  return { ok: true, attachment };
}
