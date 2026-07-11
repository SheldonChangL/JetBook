import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { getStorageProvider } from "@/lib/storage/provider";
import { getExportSpaceStatus } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "匯出檔不存在" } }, { status: 404 });
}

/**
 * Content-Disposition 一律 attachment；中文檔名走 RFC 5987 filename*，並附 ASCII fallback。
 * （對齊附件下載 route M-02 的命名策略。）
 */
function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Space 匯出 zip 下載 API（J-03）。薄殼：驗 session → 查 job → 驗 space.manage 權限（發起者
 * 或該空間管理者）→ 確認 job 已完成 → StorageProvider streaming 回應（不整檔載入記憶體）。
 * GET /api/export/[jobId]/download；未登入 401、無權限 403、未完成／不存在 404。
 */
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  const { jobId } = await context.params;
  if (!z.uuid().safeParse(jobId).success) return notFound();

  const status = await getExportSpaceStatus(jobId);
  if (!status) return notFound();

  const allowed =
    status.startedBy === session.user.id ||
    (await can(session.user, "space.manage", { type: "space", spaceId: status.spaceId }));
  if (!allowed) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "無此匯出檔的下載權限" } }, { status: 403 });
  }

  const output = status.output;
  if (!output || output.phase !== "completed" || !output.storageKey) return notFound();

  let stream: Readable;
  try {
    stream = await getStorageProvider().getStream(output.storageKey);
  } catch {
    // job 完成但暫存檔已逾期清除／遺失：對外一律 404。
    return notFound();
  }

  const fileName = output.fileName ?? "export.zip";
  const headers: Record<string, string> = {
    "Content-Type": "application/zip",
    "Content-Disposition": contentDisposition(fileName),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
  if (typeof output.sizeBytes === "number") headers["Content-Length"] = String(output.sizeBytes);

  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
}
