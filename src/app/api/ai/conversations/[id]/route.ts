import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { getConversationMessages } from "@/lib/ai/conversations";
import { getCurrentSession } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

/**
 * 載入單一對話的完整歷史（I-07，F-AI-07）。薄殼：驗 session → 驗對話擁有者（僅本人）→
 * 回傳訊息序（含 assistant 來源快照供重繪來源卡片）。非本人或不存在一律 404。
 * GET /api/ai/conversations/[id] → { id, title, messages: AiConversationMessage[] }
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("ai");

  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: t("unauthorized") } },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: t("conversationNotFound") } },
      { status: 404 },
    );
  }

  const detail = await getConversationMessages(session.user.id, id);
  if (!detail) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: t("conversationNotFound") } },
      { status: 404 },
    );
  }

  return NextResponse.json(detail, { status: 200 });
}
