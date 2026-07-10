import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { getCurrentSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { getStorageProvider } from "@/lib/storage/provider";
import { ALLOWED_FILE_TYPES, fileExtension } from "@/lib/storage/validate";

export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "附件不存在" } }, { status: 404 });
}

/**
 * 下載回應的 Content-Type：只回白名單（副檔名↔MIME 對應）內的值，
 * 名單外一律降級 application/octet-stream——即使 DB 內容被竄改也不會回可執行的 MIME。
 */
function safeContentType(fileName: string, mimeType: string): string {
  const allowed = ALLOWED_FILE_TYPES[fileExtension(fileName)];
  const mime = mimeType.toLowerCase();
  return allowed && allowed.includes(mime) ? mime : "application/octet-stream";
}

/**
 * Content-Disposition 一律 attachment（絕不 inline——HTML/SVG 類若被瀏覽器
 * 直接渲染即成同源 XSS 面）；中文檔名走 RFC 5987 filename*，並附 ASCII fallback。
 */
function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * 附件下載 API（M-02）。薄殼：驗 session → 查 attachments → 驗 page.read 權限 →
 * StorageProvider streaming 回應（不整檔載入記憶體）。
 * GET /api/files/[id]；未登入 401、無權限 403、不存在（含非 UUID）404。
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  const attachment = await db.query.attachments.findFirst({ where: eq(attachments.id, id) });
  if (!attachment) return notFound();

  if (!(await can(session.user, "page.read", { type: "page", spaceId: attachment.spaceId }))) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "無此空間的讀取權限" } },
      { status: 403 },
    );
  }

  let stream: Readable;
  try {
    stream = await getStorageProvider().getStream(attachment.storageKey);
  } catch {
    // metadata 存在但檔案本體遺失（磁碟不一致）：對外一律 404，不洩漏內部狀態
    return notFound();
  }

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": safeContentType(attachment.fileName, attachment.mimeType),
      "Content-Length": String(attachment.sizeBytes),
      "Content-Disposition": contentDisposition(attachment.fileName),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
