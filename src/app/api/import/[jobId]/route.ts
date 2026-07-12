import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { withMetrics } from "@/lib/metrics/http";
import { getImportZipStatus } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "匯入工作不存在" } }, { status: 404 });
}

/**
 * Zip 匯入狀態輪詢 API（J-02）。薄殼：驗 session → 查 job → 驗 page.edit 權限（發起者
 * 或該空間可編輯者）→ 回傳 state 與進度／結果報告。
 * GET /api/import/[jobId]；未登入 401、無權限 403、不存在 404。
 */
async function handleGET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  const { jobId } = await context.params;
  if (!z.uuid().safeParse(jobId).success) return notFound();

  const status = await getImportZipStatus(jobId);
  if (!status) return notFound();

  // 授權：發起者本人，或對該空間有編輯權者（deny by default）。
  const allowed =
    status.startedBy === session.user.id ||
    (await can(session.user, "page.edit", { type: "page", spaceId: status.spaceId }));
  if (!allowed) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "無此匯入工作的檢視權限" } }, { status: 403 });
  }

  return NextResponse.json({ data: { state: status.state, progress: status.output } }, { status: 200 });
}

export const GET = withMetrics("/api/import/[jobId]", handleGET);
