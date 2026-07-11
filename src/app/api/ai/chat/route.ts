import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { ipFromHeaders } from "@/lib/audit";
import { recordAiUsage } from "@/lib/ai/usage";
import { getCurrentSession } from "@/lib/auth/current";
import { getLlmProvider, isLlmConfigured } from "@/lib/llm";
import { logger } from "@/lib/logger";
import { streamChatAnswer, type ChatAnswerSummary } from "@/lib/rag/answer";
import { retrieve } from "@/lib/rag/retriever";
import { aiRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * RAG 問答 API（I-02，F-AI-04）。薄殼：
 * 驗 session → 檢查 AI 已設定（否則 503 AI_DISABLED）→ zod 驗 body →
 * 呼叫 lib 層 streamChatAnswer（檢索權限於 SQL 層過濾）→ 逐事件編碼為 SSE。
 * AbortSignal 貫通：client 斷線即停止 LLM 串流。
 * POST /api/ai/chat  body: { question: string, spaceId?: uuid }
 */

const chatRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  spaceId: z.string().uuid().optional(),
});

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
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
  const { question, spaceId } = parsed.data;

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
      const gen = streamChatAnswer({
        actor: session.user,
        question,
        spaceId,
        noResultsMessage,
        signal: request.signal,
        retrieveFn: retrieve,
        provider,
      });
      try {
        let summary: ChatAnswerSummary | null = null;
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
        // 用量記錄：僅在實際呼叫 LLM（有檢索結果）時記一筆 ai.query（I-06、NFR-OBS-04）。
        if (summary) {
          logger.info(
            {
              actorId: session.user.id,
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
