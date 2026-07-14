import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/current";
import { withMetrics } from "@/lib/metrics/http";
import { resolvePdfPreview } from "@/lib/storage/preview";
import { getStorageProvider } from "@/lib/storage/provider";

export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "附件不存在" } }, { status: 404 });
}

/**
 * PDF 附件線上預覽（M4-11，issue #215）。薄殼：驗 session → resolvePdfPreview
 * （僅 PDF、page.read 權限，決策集中在 lib 層）→ streaming inline 回應。
 * 既有下載端點（/api/files/[id]）維持一律 attachment，安全邊界不放寬。
 * GET /api/files/[id]/preview；未登入 401、無權限 403、不存在/非 PDF 404。
 */
async function handleGET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  const { id } = await context.params;
  const result = await resolvePdfPreview(session.user, id);
  if (!result.ok) {
    if (result.status === 403) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "無此空間的讀取權限" } },
        { status: 403 },
      );
    }
    return notFound();
  }

  const { attachment } = result;
  let stream: Readable;
  try {
    stream = await getStorageProvider().getStream(attachment.storageKey);
  } catch {
    // metadata 存在但檔案本體遺失：對外一律 404（與下載端點一致）
    return notFound();
  }

  const fallback = attachment.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      // resolvePdfPreview 已保證副檔名與 MIME 皆為 PDF，Content-Type 固定不信任 DB 字串
      "Content-Type": "application/pdf",
      "Content-Length": String(attachment.sizeBytes),
      "Content-Disposition": `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export const GET = withMetrics("/api/files/[id]/preview", handleGET);
