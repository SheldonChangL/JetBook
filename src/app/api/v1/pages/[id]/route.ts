import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { pages, spaces } from "@/lib/db/schema";
import { requireApiAuth } from "@/lib/api-tokens/bearer";
import { canReadPage } from "@/lib/authz/permission";
import {
  API_PAGE_TITLE_MAX_CHARS,
  API_WRITE_MARKDOWN_MAX_CHARS,
  apiUpdatePage,
} from "@/lib/api/page-write";

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

const patchSchema = z
  .object({
    markdown: z.string().min(1).max(API_WRITE_MARKDOWN_MAX_CHARS).optional(),
    title: z.string().trim().min(1).max(API_PAGE_TITLE_MAX_CHARS).optional(),
    // 0 合法：從未寫入內容的頁面 currentVersionNo 為 0
    expectedVersion: z.number().int().min(0).optional(),
  })
  .refine((d) => d.markdown !== undefined || d.title !== undefined, {
    message: "markdown 與 title 至少需提供一項",
  });

/**
 * PATCH /api/v1/pages/{id}：部分更新頁面（M4-09/M4-13）。
 * - markdown：全量取代內容；title：改名（slug 重算＋301 歷史）；至少提供一項。
 * - expectedVersion：樂觀鎖，不符回 409 CONFLICT（含 currentVersion 供重讀）。
 * scope=write；權限/鎖/儲存管線一律由 lib/api/page-write 負責（薄殼原則）。
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const result = await requireApiAuth(request, "write");
  if (!result.ok) return result.response;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_BODY",
          message:
            "body 需含 markdown 或 title 至少一項（非空字串）；expectedVersion 為選填整數（≥0，未寫入過內容的頁面版本為 0）",
        },
      },
      { status: 400 },
    );
  }

  const outcome = await apiUpdatePage(result.auth.user, {
    pageId: id,
    markdown: body.data.markdown,
    title: body.data.title,
    expectedVersion: body.data.expectedVersion,
  });
  if (!outcome.ok) {
    if (outcome.error === "LOCKED") {
      return NextResponse.json(
        { error: { code: "LOCKED", message: `頁面正由 ${outcome.lockedByName ?? "他人"} 編輯中` } },
        { status: 409 },
      );
    }
    if (outcome.error === "CONFLICT") {
      return NextResponse.json(
        {
          error: {
            code: "CONFLICT",
            message: "版本不符或頁面同時被其他寫入更新，請重新讀取後再試",
            currentVersion: outcome.currentVersionNo,
          },
        },
        { status: 409 },
      );
    }
    return notFound();
  }
  return NextResponse.json({ data: outcome.page });
}
