import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { recordAiUsage, type AiQueryMode } from "@/lib/ai/usage";
import { ipFromHeaders } from "@/lib/audit";
import { getCurrentSession } from "@/lib/auth/current";
import { getEmbeddingProvider, isEmbeddingConfigured } from "@/lib/llm";
import { aiRateLimiter } from "@/lib/rate-limit";
import { fullTextSearch } from "@/lib/search/fulltext";
import { semanticSearch } from "@/lib/search/semantic";

export const dynamic = "force-dynamic";

/**
 * 搜尋 API（F-SEARCH-01 全文 + I-05 語意）。薄殼：驗 session → 呼叫 lib 層（權限在 SQL 過濾）。
 * GET /api/search?q=...&space=<uuid>&mode=fulltext|semantic|hybrid
 * - mode 省略或 fulltext：pgroonga 全文搜尋（既有行為；非 AI，不限流）。
 * - mode=semantic：僅向量路語意搜尋（I-01 retrieve），命中近義未含原詞的頁。
 * - mode=hybrid：全文+向量 RRF 融合。
 * semantic/hybrid 為 AI（embedding）路徑（I-06）：每使用者限流 20 次/分（NFR-SEC-07，超限 429 +
 * Retry-After），並在實際發生 embedding 呼叫時記一筆 ai.query 用量（NFR-OBS-04）。
 * 未設定 embedding 時 semanticSearch 回空 hits（不 500；不計用量）。
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const spaceId = url.searchParams.get("space") ?? undefined;
  const mode = url.searchParams.get("mode") ?? "fulltext";

  if (mode === "semantic" || mode === "hybrid") {
    // AI 端點限流（NFR-SEC-07：20 次/分/使用者，與 /api/ai/chat 共用配額）→ 429 + Retry-After。
    const rate = aiRateLimiter.check(session.user.id);
    if (!rate.allowed) {
      const t = await getTranslations("ai");
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: t("rateLimited") } },
        { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds) } },
      );
    }

    const startedAt = Date.now();
    const hits = await semanticSearch(session.user, q, { spaceId, mode });

    // 用量記錄：僅在實際發生 embedding 呼叫（已設定 + 非空查詢）時記一筆（I-06）。
    if (isEmbeddingConfigured() && q.trim() !== "") {
      await recordAiUsage({
        actorId: session.user.id,
        model: getEmbeddingProvider().model,
        // embedding 檢索無 token 計費：以 0 記錄，mode 供功能分項統計。
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - startedAt,
        mode: mode as AiQueryMode,
        ip: ipFromHeaders(request.headers),
      });
    }

    return NextResponse.json({ data: { hits } });
  }

  const hits = await fullTextSearch(session.user, q, { spaceId });
  return NextResponse.json({ data: { hits } });
}
