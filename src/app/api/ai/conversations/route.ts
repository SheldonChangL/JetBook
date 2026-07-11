import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { listConversations } from "@/lib/ai/conversations";
import { getCurrentSession } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

/**
 * 本人的 AI 對話歷史列表（I-07，F-AI-07）。薄殼：驗 session → 查本人對話（僅含有訊息者，
 * 依最近更新排序）。對話為使用者私有資源，一律 `where user_id = 自己`（非 space/page RBAC）。
 * GET /api/ai/conversations → { conversations: AiConversationSummary[] }
 */
export async function GET() {
  const t = await getTranslations("ai");

  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: t("unauthorized") } },
      { status: 401 },
    );
  }

  const conversations = await listConversations(session.user.id);
  return NextResponse.json({ conversations }, { status: 200 });
}
