import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-tokens/bearer";
import { getAccessiblePageIds } from "@/lib/authz/permission";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import { listSpaceTreeNodes } from "@/lib/pages/tree";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/spaces/{slug}/pages：空間頁面樹（M4-06）。
 * 權限：空間以可存取清單解析（不存在與無權一律 404，避免枚舉）；
 * 節點再以 getAccessiblePageIds 過濾（restricted 頁不外洩）。
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const result = await requireApiAuth(request, "read");
  if (!result.ok) return result.response;
  const { slug } = await ctx.params;

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
