import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/api-tokens/bearer";
import {
  SPACE_DESCRIPTION_MAX_CHARS,
  SPACE_NAME_MAX_CHARS,
  apiCreateSpace,
} from "@/lib/api/space-write";
import { listAccessibleSpaces } from "@/lib/spaces/queries";

export const dynamic = "force-dynamic";

/** GET /api/v1/spaces：列出呼叫者可存取的空間（M4-06，F-API-01）。 */
export async function GET(request: Request) {
  const result = await requireApiAuth(request, "read");
  if (!result.ok) return result.response;

  const spaces = await listAccessibleSpaces(result.auth.user);
  return NextResponse.json({
    data: spaces.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      icon: s.icon,
      visibility: s.visibility,
    })),
  });
}

const postSchema = z.object({
  name: z.string().trim().min(1).max(SPACE_NAME_MAX_CHARS),
  description: z.string().trim().max(SPACE_DESCRIPTION_MAX_CHARS).optional(),
});

/**
 * POST /api/v1/spaces：建立空間（M4-13，issue #218）。
 * scope=write；slug 自動產生（重名自動加尾碼）、建立者成為該空間 admin
 * ——皆由 lib/api/space-write（→ createSpaceCore 唯一建立路徑）負責。
 */
export async function POST(request: Request) {
  const result = await requireApiAuth(request, "write");
  if (!result.ok) return result.response;

  const body = postSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "body 需含 name（1–100 字）；description 選填（≤500 字）" } },
      { status: 400 },
    );
  }

  const space = await apiCreateSpace(result.auth.user, body.data);
  return NextResponse.json({ data: space }, { status: 201 });
}
