import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { getExportSpaceStatus } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "匯出工作不存在" } }, { status: 404 });
}

/**
 * Space 匯出狀態輪詢 API（J-03）。薄殼：驗 session → 查 job → 驗 space.manage 權限（發起者
 * 或該空間管理者）→ 回傳 state 與進度／結果報告（storageKey 為內部鍵，不外洩）。
 * GET /api/export/[jobId]；未登入 401、無權限 403、不存在 404。
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

  // 授權：發起者本人，或對該空間有管理權者（deny by default）。
  const allowed =
    status.startedBy === session.user.id ||
    (await can(session.user, "space.manage", { type: "space", spaceId: status.spaceId }));
  if (!allowed) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "無此匯出工作的檢視權限" } }, { status: 403 });
  }

  // storageKey 為內部儲存鍵：不回給前端；下載一律經 /api/export/[jobId]/download。
  const output = status.output;
  const progress = output
    ? {
        phase: output.phase,
        processed: output.processed,
        total: output.total,
        exportedPages: output.exportedPages,
        includedAssets: output.includedAssets,
        fileName: output.fileName ?? null,
        sizeBytes: output.sizeBytes ?? null,
        downloadable: output.phase === "completed" && Boolean(output.storageKey),
        errorCode: output.errorCode ?? null,
        errorMessage: output.errorMessage ?? null,
      }
    : null;

  return NextResponse.json({ data: { state: status.state, progress } }, { status: 200 });
}
