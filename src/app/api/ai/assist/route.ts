import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { ipFromHeaders } from "@/lib/audit";
import { recordAiUsage } from "@/lib/ai/usage";
import { getCurrentSession } from "@/lib/auth/current";
import { canEditPage } from "@/lib/authz/permission";
import { getLlmProvider, isLlmConfigured } from "@/lib/llm";
import { logger } from "@/lib/logger";
import { aiRateLimiter } from "@/lib/rate-limit";
import { streamAssist, type AssistSummary } from "@/lib/ai/assist";
import { ASSIST_MAX_INPUT_CHARS, ASSIST_MODES } from "@/lib/ai/assist-modes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 編輯器寫作輔助 API（I-08，F-AI-08）。薄殼：
 * 驗 session → 檢查 AI 已設定（否則 503 AI_DISABLED）→ zod 驗 body →
 * 驗 page.edit 權限（authz 唯一入口 canEditPage）→ 速率限制（per user）→
 * 呼叫 lib 層 streamAssist（light tier）→ 逐事件編碼為 SSE。
 * AbortSignal 貫通：client 斷線即停止 LLM 串流。結果永不直接覆寫原文，套用與否由前端使用者決定。
 * POST /api/ai/assist  body: { mode, text, pageId }
 */

const assistRequestSchema = z.object({
  mode: z.enum(ASSIST_MODES),
  text: z.string().trim().min(1).max(ASSIST_MAX_INPUT_CHARS),
  pageId: z.string().uuid(),
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: t("invalidRequest") } },
      { status: 400 },
    );
  }
  const parsed = assistRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: t("invalidRequest") } },
      { status: 400 },
    );
  }
  const { mode, text, pageId } = parsed.data;

  // 權限：僅可對「有編輯權」的頁面使用寫作輔助（authz 唯一入口，預設拒絕）。
  if (!(await canEditPage(session.user, pageId))) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: t("forbidden") } },
      { status: 403 },
    );
  }

  // 速率限制（per user）：超限回 429 並附 Retry-After。
  const limit = aiRateLimiter.check(`assist:${session.user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: t("rateLimited") } },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const provider = getLlmProvider();
  const encoder = new TextEncoder();
  const ip = ipFromHeaders(request.headers);

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
      const gen = streamAssist({ mode, text, provider, signal: request.signal });
      try {
        let summary: AssistSummary | null = null;
        for (;;) {
          const step = await gen.next();
          if (step.done) {
            summary = step.value;
            break;
          }
          const evt = step.value;
          controller.enqueue(encoder.encode(frame(evt.event, evt.data)));
        }
        safeClose();
        // 用量記錄：每次 LLM 呼叫後記一筆 ai.query（I-06、NFR-OBS-04）。
        if (summary) {
          logger.info(
            {
              actorId: session.user.id,
              pageId,
              mode,
              model: summary.model,
              inputTokens: summary.usage.inputTokens,
              outputTokens: summary.usage.outputTokens,
            },
            "ai assist",
          );
          await recordAiUsage({
            actorId: session.user.id,
            model: summary.model,
            inputTokens: summary.usage.inputTokens,
            outputTokens: summary.usage.outputTokens,
            latencyMs: Date.now() - startedAt,
            mode: "assist",
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
          "ai assist failed",
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
      // 關閉反向代理緩衝，確保串流即時。
      "x-accel-buffering": "no",
    },
  });
}
