import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/api-tokens/bearer";
import {
  SPACE_DESCRIPTION_MAX_CHARS,
  SPACE_NAME_MAX_CHARS,
  apiUpdateSpace,
} from "@/lib/api/space-write";
import { decodeRouteParam } from "@/lib/utils";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(SPACE_NAME_MAX_CHARS).optional(),
  description: z.string().trim().max(SPACE_DESCRIPTION_MAX_CHARS).nullable().optional(),
  icon: z.string().trim().max(16).nullable().optional(),
  visibility: z.enum(["private", "org_read", "org_write"]).optional(),
});

/**
 * PATCH /api/v1/spaces/{slug}：更新空間設定（M4 空間管理 API）。
 * scope=write + space.manage；至少提供一個欄位。
 * 空間不存在或無管理權一律 404（防枚舉，與其他空間端點一致）。
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const result = await requireApiAuth(request, "write");
  if (!result.ok) return result.response;
  // route param 為 percent-encoded；含 CJK 的 slug 須還原才比對得到 DB（issue #207）
  const slug = decodeRouteParam((await ctx.params).slug);

  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success || Object.keys(body.data).length === 0) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_BODY",
          message: "body 需含 name／description／icon／visibility 至少一項",
        },
      },
      { status: 400 },
    );
  }

  const outcome = await apiUpdateSpace(result.auth.user, { spaceSlug: slug, ...body.data });
  if (!outcome.ok) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "空間不存在或無管理權限" } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: outcome.space });
}
