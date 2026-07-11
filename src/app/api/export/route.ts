import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { getCurrentSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { enqueueExportSpace } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ spaceId: z.uuid() });

/**
 * 整個 Space Markdown 匯出啟動 API（J-03）。薄殼：驗 session → 驗 space.manage 權限 →
 * enqueue export-space job（實際遍歷樹／打包 zip 在 worker）。回傳 jobId 供輪詢。
 * POST /api/export（JSON：{ spaceId }）；未登入 401、無權限 403、空間不存在 404。
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "需為 JSON" } }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "缺少 spaceId（uuid）" } },
      { status: 400 },
    );
  }
  const { spaceId } = parsed.data;

  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, spaceId) });
  if (!space || space.deletedAt) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "空間不存在" } }, { status: 404 });
  }

  // 匯出為空間管理動作（設定頁）：需 space.manage（deny by default）。
  if (!(await can(session.user, "space.manage", { type: "space", spaceId }))) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "無此空間的管理權限" } }, { status: 403 });
  }

  const jobId = await enqueueExportSpace({
    spaceId,
    spaceName: space.name,
    userId: session.user.id,
  });
  if (!jobId) {
    return NextResponse.json(
      { error: { code: "ENQUEUE_FAILED", message: "無法建立匯出工作" } },
      { status: 500 },
    );
  }

  await writeAudit({
    actorId: session.user.id,
    action: "space.export",
    targetType: "space",
    targetId: spaceId,
    metadata: { jobId },
    ip: ipFromHeaders(request.headers),
  });

  return NextResponse.json({ data: { jobId } }, { status: 202 });
}
