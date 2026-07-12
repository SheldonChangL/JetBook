import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { ipFromHeaders } from "@/lib/audit";
import { recordAiUsage } from "@/lib/ai/usage";
import { checkAiDailyQuota } from "@/lib/ai/quota";
import { getConversation } from "@/lib/ai/conversations";
import {
  runConversationChat,
  type ConversationChatSummary,
} from "@/lib/ai/conversation-chat";
import { getCurrentSession } from "@/lib/auth/current";
import { getLlmProvider, isLlmConfigured } from "@/lib/llm";
import { logger } from "@/lib/logger";
import { withMetrics } from "@/lib/metrics/http";
import { retrieve } from "@/lib/rag/retriever";
import { aiRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * RAG 多輪問答 API（I-02／I-07，F-AI-04／F-AI-07）。薄殼：
 * 驗 session → 檢查 AI 已設定（否則 503 AI_DISABLED）→ 限流 → zod 驗 body →
 * 續談時驗對話擁有者（getConversation，非本人一律 404）→ 呼叫 lib 層 runConversationChat
 * （建立/載入對話、query rewrite、檢索權限於 SQL 層過濾、串流、持久化訊息與來源快照）→
 * 逐事件編碼為 SSE。AbortSignal 貫通：client 斷線即停止 LLM 串流。
 * POST /api/ai/chat  body: { question: string, spaceId?: uuid, conversationId?: uuid }
 */

const chatRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  spaceId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
});

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function handlePOST(request: Request) {
  const t = await getTranslations("ai");

  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: t("unauthorized") } },
      { status: 401 },
    );
  }

  // AI 未設定：回 503，讓前端隱藏／降級 AI 入口（不讓 provider 錯誤外洩到流程）。
  if (!isLlmConfigured()) {
    return NextResponse.json(
      { error: { code: "AI_DISABLED", message: t("disabled") } },
      { status: 503 },
    );
  }

  // 每使用者限流（NFR-SEC-07：AI 端點 20 次/分/使用者）→ 429 + Retry-After。
  const rate = aiRateLimiter.check(session.user.id);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: t("rateLimited") } },
      { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds) } },
    );
  }

  // AI 每人每日配額（I-09，F-AI-11）：限流之後，以當日已用 ai.query 計數對照
  // org_settings 配額（null＝不限）。達額回 429 QUOTA_EXCEEDED（與限流分開的錯誤碼，
  // 前端顯示配額用罄訊息，非重試提示）。
  const quota = await checkAiDailyQuota(session.user.id);
  if (quota.exceeded) {
    return NextResponse.json(
      { error: { code: "QUOTA_EXCEEDED", message: t("quotaExceeded") } },
      { status: 429 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: t("invalidRequest") } },
      { status: 400 },
    );
  }
  const parsed = chatRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: t("invalidRequest") } },
      { status: 400 },
    );
  }
  const { question, spaceId, conversationId } = parsed.data;

  // 續談：驗對話擁有者（僅本人）。非本人或不存在一律 404（不區分，避免存在性洩漏）。
  // 續談沿用對話原本的檢索範圍（spaceId 快照），新對話才採 body 的 spaceId。
  let scopeSpaceId = spaceId;
  if (conversationId) {
    const conversation = await getConversation(session.user.id, conversationId);
    if (!conversation) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: t("conversationNotFound") } },
        { status: 404 },
      );
    }
    scopeSpaceId = conversation.spaceId ?? undefined;
  }

  const provider = getLlmProvider();
  const noResultsMessage = t("noResults");
  const encoder = new TextEncoder();
  const ip = ipFromHeaders(request.headers);

  let sourceCount = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // stream 可能已被 client 斷線取消（controller 關閉）：close/enqueue 皆須容錯。
      const safeClose = () => {
        try {
          controller.close();
        } catch {
          // 已關閉／已取消
        }
      };
      const startedAt = Date.now();
      // 手動迭代以取得 generator 回傳的用量摘要（含 model；不進 SSE 幀，不外洩 client）。
      const gen = runConversationChat({
        actor: session.user,
        question,
        conversationId,
        spaceId: scopeSpaceId,
        noResultsMessage,
        signal: request.signal,
        retrieveFn: retrieve,
        provider,
      });
      try {
        let summary: ConversationChatSummary | null = null;
        for (;;) {
          const step = await gen.next();
          if (step.done) {
            summary = step.value;
            break;
          }
          const evt = step.value;
          if (evt.event === "sources") sourceCount = evt.data.length;
          controller.enqueue(encoder.encode(frame(evt.event, evt.data)));
        }
        safeClose();
        // 用量記錄：僅在實際呼叫 LLM 生成（有檢索結果）時記一筆 ai.query（I-06、NFR-OBS-04）。
        if (summary && summary.usage && summary.model) {
          logger.info(
            {
              actorId: session.user.id,
              conversationId: summary.conversationId,
              sourceCount,
              model: summary.model,
              inputTokens: summary.usage.inputTokens,
              outputTokens: summary.usage.outputTokens,
            },
            "ai chat",
          );
          await recordAiUsage({
            actorId: session.user.id,
            model: summary.model,
            inputTokens: summary.usage.inputTokens,
            outputTokens: summary.usage.outputTokens,
            latencyMs: Date.now() - startedAt,
            mode: "chat",
            ip,
          });
        }
      } catch (err) {
        // client 斷線：LLM 已依 signal 停止，安靜關閉，不視為錯誤。
        if (request.signal.aborted) {
          safeClose();
          return;
        }
        logger.error(
          { actorId: session.user.id, err: err instanceof Error ? err.message : String(err) },
          "ai chat failed",
        );
        try {
          controller.enqueue(encoder.encode(frame("error", { message: t("failed") })));
        } catch {
          // controller 可能已因先前 enqueue 而處於關閉中狀態
        }
        safeClose();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // 關閉反向代理緩衝，確保 TTFT（C10 TTFT P95 < 4s）。
      "x-accel-buffering": "no",
    },
  });
}

export const POST = withMetrics("/api/ai/chat", handlePOST);
