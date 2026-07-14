import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/api-tokens/bearer";
import { apiMovePage } from "@/lib/api/page-write";

export const dynamic = "force-dynamic";

const notFound = () =>
  NextResponse.json(
    { error: { code: "NOT_FOUND", message: "頁面不存在或無權存取" } },
    { status: 404 },
  );

const moveSchema = z.object({
  /** 跨空間搬移的目的地（省略＝同空間 reparent） */
  targetSpaceId: z.uuid().optional(),
  /** 同空間搬移的新父節點（null＝根層）；跨空間不支援（一律掛目標根層） */
  newParentId: z.uuid().nullable().optional(),
});

/**
 * POST /api/v1/pages/{id}/move：搬移頁面（M4-14，issue #219）。
 * scope=write；權限（來源＋目標 page.edit）/循環防護/附件歸屬轉移一律由
 * lib/api/page-write 的 apiMovePage 負責（薄殼原則）。
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const result = await requireApiAuth(request, "write");
  if (!result.ok) return result.response;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  const body = moveSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_BODY",
          message: "body 需含 targetSpaceId（跨空間）或 newParentId（同空間，null＝根層）",
        },
      },
      { status: 400 },
    );
  }

  const outcome = await apiMovePage(result.auth.user, {
    pageId: id,
    targetSpaceId: body.data.targetSpaceId,
    newParentId: body.data.newParentId,
  });
  if (!outcome.ok) {
    if (outcome.error === "CYCLE") {
      return NextResponse.json(
        { error: { code: "CYCLE", message: "不可搬移到自己或自己的子頁面之下" } },
        { status: 409 },
      );
    }
    if (outcome.error === "INVALID") {
      return NextResponse.json(
        { error: { code: "INVALID_MOVE", message: outcome.message } },
        { status: 400 },
      );
    }
    return notFound();
  }
  return NextResponse.json({ data: { ...outcome.page, movedCount: outcome.movedCount } });
}
