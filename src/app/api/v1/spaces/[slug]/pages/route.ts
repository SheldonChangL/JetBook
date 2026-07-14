import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { requireApiAuth } from "@/lib/api-tokens/bearer";
import { getAccessiblePageIds } from "@/lib/authz/permission";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import { listSpaceTreeNodes } from "@/lib/pages/tree";
import { API_WRITE_MARKDOWN_MAX_CHARS, apiCreatePage } from "@/lib/api/page-write";
import { decodeRouteParam } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/spaces/{slug}/pages：空間頁面樹（M4-06）。
 * 權限：空間以可存取清單解析（不存在與無權一律 404，避免枚舉）；
 * 節點再以 getAccessiblePageIds 過濾（restricted 頁不外洩）。
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const result = await requireApiAuth(request, "read");
  if (!result.ok) return result.response;
  // route param 為 percent-encoded；含 CJK 的 slug 須還原才比對得到 DB（issue #207）
  const slug = decodeRouteParam((await ctx.params).slug);

  const spaces = await listAccessibleSpaces(result.auth.user);
  const space = spaces.find((s) => s.slug === slug);
  if (!space) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "空間不存在或無權存取" } },
      { status: 404 },
    );
  }

  const [nodes, accessibleIds] = await Promise.all([
    listSpaceTreeNodes(space.id),
    getAccessiblePageIds(result.auth.user, space.id),
  ]);
  const readable = new Set(accessibleIds);

  return NextResponse.json({
    data: nodes
      .filter((n) => readable.has(n.id))
      .map((n) => ({
        id: n.id,
        parentId: n.parentId,
        slug: n.slug,
        title: n.title,
        icon: n.icon,
        kind: n.kind,
        externalUrl: n.externalUrl,
      })),
  });
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  markdown: z.string().min(1).max(API_WRITE_MARKDOWN_MAX_CHARS),
  /** 父節點 id；省略＝根層 */
  parentId: z.uuid().nullish(),
});

/**
 * POST /api/v1/spaces/{slug}/pages：建立頁面並寫入 Markdown 內容（M4-09）。
 * scope=write；權限/儲存管線一律由 lib/api/page-write 負責（薄殼原則）。
 * 空間不存在與無權一律 404（防枚舉，同 GET）。
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const result = await requireApiAuth(request, "write");
  if (!result.ok) return result.response;
  const slug = decodeRouteParam((await ctx.params).slug);

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "body 需含 title 與 markdown" } },
      { status: 400 },
    );
  }

  const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, slug) });
  if (!space || space.deletedAt) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "空間不存在或無權存取" } },
      { status: 404 },
    );
  }

  const outcome = await apiCreatePage(result.auth.user, {
    spaceId: space.id,
    parentId: body.data.parentId ?? null,
    title: body.data.title,
    markdown: body.data.markdown,
  });
  if (!outcome.ok) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "空間/父節點不存在或無權存取" } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: outcome.page }, { status: 201 });
}
