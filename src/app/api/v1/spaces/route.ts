import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-tokens/bearer";
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
