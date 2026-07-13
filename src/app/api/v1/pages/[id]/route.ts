import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { pages, spaces } from "@/lib/db/schema";
import { requireApiAuth } from "@/lib/api-tokens/bearer";
import { canReadPage } from "@/lib/authz/permission";

export const dynamic = "force-dynamic";

const notFound = () =>
  NextResponse.json(
    { error: { code: "NOT_FOUND", message: "頁面不存在或無權存取" } },
    { status: 404 },
  );

/**
 * GET /api/v1/pages/{id}：讀取單一頁面（M4-06）。
 * 權限：canReadPage（lib/authz 唯一入口）；不存在與無權一律 404（避免枚舉）。
 * 內容回 content_md（既有衍生欄位，機器可讀），不回 TipTap JSON。
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const result = await requireApiAuth(request, "read");
  if (!result.ok) return result.response;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  const page = await db.query.pages.findFirst({ where: eq(pages.id, id) });
  if (!page || page.deletedAt || page.kind !== "page") return notFound();
  if (!(await canReadPage(result.auth.user, page.id))) return notFound();

  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, page.spaceId) });
  if (!space) return notFound();

  return NextResponse.json({
    data: {
      id: page.id,
      title: page.title,
      icon: page.icon,
      slug: page.slug,
      spaceSlug: space.slug,
      contentMd: page.contentMd,
      versionNo: page.currentVersionNo,
      updatedAt: page.updatedAt,
    },
  });
}
