import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/api-tokens/bearer";
import { apiSetSpaceMember } from "@/lib/api/space-write";
import { decodeRouteParam } from "@/lib/utils";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  email: z.string().trim().min(1),
  role: z.enum(["admin", "editor", "commenter", "viewer", "none"]),
});

/**
 * PUT /api/v1/spaces/{slug}/members：設定/變更/移除空間成員（M4 空間管理 API）。
 * scope=write + space.manage；role=none 移除成員。
 * 空間不存在/無管理權 404；查無啟用帳號 404；最後一位 admin 不可移除/降級 409。
 */
export async function PUT(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const result = await requireApiAuth(request, "write");
  if (!result.ok) return result.response;
  const slug = decodeRouteParam((await ctx.params).slug);

  const body = putSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_BODY",
          message: "body 需含 email 與 role（admin／editor／commenter／viewer／none）",
        },
      },
      { status: 400 },
    );
  }

  const outcome = await apiSetSpaceMember(result.auth.user, {
    spaceSlug: slug,
    email: body.data.email,
    role: body.data.role === "none" ? null : body.data.role,
  });
  if (!outcome.ok) {
    if (outcome.error === "USER_NOT_FOUND") {
      return NextResponse.json(
        { error: { code: "USER_NOT_FOUND", message: "找不到該 email 的啟用帳號" } },
        { status: 404 },
      );
    }
    if (outcome.error === "LAST_ADMIN") {
      return NextResponse.json(
        { error: { code: "LAST_ADMIN", message: "不可移除或降級空間最後一位管理員" } },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "空間不存在或無管理權限" } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: { email: outcome.email, role: outcome.role } });
}
