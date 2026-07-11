import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { getCurrentSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { pageFileMarkdown, sanitizeSegment } from "@/lib/content/export-markdown";

export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "頁面不存在" } }, { status: 404 });
}

/**
 * Content-Disposition 一律 attachment（供「下載 .md」）；中文檔名走 RFC 5987 filename*，
 * 並附 ASCII fallback。「複製為 Markdown」由前端 fetch 讀 body 後寫入剪貼簿（不受此影響）。
 */
function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * 單頁 Markdown 匯出 API（J-03）。薄殼：驗 session → 查未刪除頁 → 驗 page.read 權限 →
 * 回傳 `# 標題` + content_md（直用衍生欄位）。供閱讀頁「複製為 Markdown／下載 .md」。
 * GET /api/pages/[id]/markdown；未登入 401、無權限 403、不存在（含非 UUID）404。
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, id), isNull(pages.deletedAt)),
    columns: { id: true, spaceId: true, title: true, contentMd: true },
  });
  if (!page) return notFound();

  if (!(await can(session.user, "page.read", { type: "page", spaceId: page.spaceId }))) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "無此空間的讀取權限" } },
      { status: 403 },
    );
  }

  const markdown = pageFileMarkdown(page.title, page.contentMd);
  const fileName = `${sanitizeSegment(page.title) || "page"}.md`;

  return new Response(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": contentDisposition(fileName),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
