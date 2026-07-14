import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/current";
import { withMetrics } from "@/lib/metrics/http";
import { resolveAttachmentPreview } from "@/lib/storage/preview";
import { getStorageProvider } from "@/lib/storage/provider";

export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "附件不存在" } }, { status: 404 });
}

/**
 * 附件線上預覽（M4-11 PDF／M4-12 Office 衍生 PDF）。薄殼：驗 session →
 * resolveAttachmentPreview（型別/權限/衍生狀態決策集中在 lib 層）→ streaming inline 回應。
 * 既有下載端點（/api/files/[id]）維持一律 attachment，安全邊界不放寬。
 * GET /api/files/[id]/preview；未登入 401、無權限 403、不可預覽 404、Office 轉檔中 202。
 */
async function handleGET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  const { id } = await context.params;
  const result = await resolveAttachmentPreview(session.user, id);
  if (!result.ok) {
    if (result.status === 202) {
      return NextResponse.json(
        { data: { status: "pending" } },
        { status: 202, headers: { "Retry-After": "3", "Cache-Control": "private, no-store" } },
      );
    }
    if (result.status === 403) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "無此空間的讀取權限" } },
        { status: 403 },
      );
    }
    return notFound();
  }

  let stream: Readable;
  try {
    stream = await getStorageProvider().getStream(result.storageKey);
  } catch {
    // metadata 存在但檔案本體遺失：對外一律 404（與下載端點一致）
    return notFound();
  }

  const fallback = result.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      // resolve 已保證內容為 PDF（原生雙比對或衍生檔），Content-Type 固定不信任 DB 字串
      "Content-Type": "application/pdf",
      ...(result.sizeBytes !== null ? { "Content-Length": String(result.sizeBytes) } : {}),
      "Content-Disposition": `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export const GET = withMetrics("/api/files/[id]/preview", handleGET);
