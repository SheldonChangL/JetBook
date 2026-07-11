import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatDelta,
  ChatParams,
  ChatResult,
  ChatStreamResult,
  ChatUsage,
  LLMProvider,
} from "@/lib/llm";
import type { RetrievedChunk } from "@/lib/rag/retriever";
import { slugifyHeadingText } from "@/lib/content/heading-slug";

/**
 * Route 層測試（薄殼 + 真實 answer 編排）：只 mock 邊界（session/llm 設定/retrieve/i18n），
 * 走真實 streamChatAnswer 與 SSE 編碼，驗證事件序、狀態碼與「無結果不打 LLM」。
 */

const messages: Record<string, string> = {
  noResults: "知識庫中找不到相關資訊。",
  disabled: "AI 功能未啟用",
  unauthorized: "需登入",
  invalidRequest: "問題內容不正確",
  failed: "AI 回答產生失敗，請稍後再試",
};

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => messages[key] ?? key,
}));

const getCurrentSession = vi.fn();
vi.mock("@/lib/auth/current", () => ({
  getCurrentSession: () => getCurrentSession(),
}));

const isLlmConfigured = vi.fn();
const getLlmProvider = vi.fn();
vi.mock("@/lib/llm", () => ({
  isLlmConfigured: () => isLlmConfigured(),
  getLlmProvider: () => getLlmProvider(),
}));

const retrieve = vi.fn();
vi.mock("@/lib/rag/retriever", () => ({
  retrieve: (...args: unknown[]) => retrieve(...args),
}));

// audit（server-only + DB）：只需 ipFromHeaders，不觸 DB。
vi.mock("@/lib/audit", () => ({
  ipFromHeaders: () => "10.0.0.1",
}));

const recordAiUsage = vi.fn();
vi.mock("@/lib/ai/usage", () => ({
  recordAiUsage: (...args: unknown[]) => recordAiUsage(...args),
}));

const aiRateCheck = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  aiRateLimiter: { check: (...args: unknown[]) => aiRateCheck(...args) },
}));

import { POST } from "./route";

class FakeProvider implements LLMProvider {
  readonly name = "fake";
  chatStreamCalls = 0;
  constructor(
    private deltas: string[] = ["答案"],
    private usage: ChatUsage = { inputTokens: 20, outputTokens: 6 },
    private modelId = "fake-model",
  ) {}
  async *chatStream(_params: ChatParams): AsyncGenerator<ChatDelta, ChatStreamResult> {
    void _params;
    this.chatStreamCalls += 1;
    for (const text of this.deltas) yield { type: "text", text };
    return { usage: this.usage, model: this.modelId };
  }
  async chat(): Promise<ChatResult> {
    throw new Error("未使用");
  }
}

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    pageId: "page-1",
    chunkIndex: 0,
    headingPath: "章節",
    chunkText: "內容片段",
    score: 0.5,
    title: "標題",
    spaceSlug: "ops",
    spaceName: "維運空間",
    pageSlug: "doc",
    ...overrides,
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 讀取整個 SSE 回應為文字。 */
async function readSse(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

/** 解析 SSE 文字為 {event, data} 陣列。 */
function parseSse(text: string): { event: string; data: unknown }[] {
  return text
    .split("\n\n")
    .filter((b) => b.trim().length > 0)
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event:"))!.slice(6).trim();
      const data = lines.find((l) => l.startsWith("data:"))!.slice(5).trim();
      return { event, data: JSON.parse(data) };
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentSession.mockResolvedValue({ user: { id: "user-1", orgRole: "member" } });
  isLlmConfigured.mockReturnValue(true);
  aiRateCheck.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
});

describe("POST /api/ai/chat", () => {
  it("未登入回 401", async () => {
    getCurrentSession.mockResolvedValue(null);
    const res = await POST(post({ question: "hi" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("AI 未設定回 503 AI_DISABLED", async () => {
    isLlmConfigured.mockReturnValue(false);
    const res = await POST(post({ question: "hi" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("AI_DISABLED");
  });

  it("超過限流回 429 + Retry-After（NFR-SEC-07）", async () => {
    aiRateCheck.mockReturnValue({ allowed: false, retryAfterSeconds: 42 });
    const res = await POST(post({ question: "hi" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    // 限流以 user id 為 key。
    expect(aiRateCheck).toHaveBeenCalledWith("user-1");
  });

  it("空問題回 400", async () => {
    const res = await POST(post({ question: "   " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("非 JSON body 回 400", async () => {
    const req = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("有結果：SSE 事件序 sources → delta → done(usage)", async () => {
    const provider = new FakeProvider(["雷射", "校準"], { inputTokens: 40, outputTokens: 9 });
    getLlmProvider.mockReturnValue(provider);
    retrieve.mockResolvedValue([chunk({ title: "手冊", spaceSlug: "ops", pageSlug: "m1" })]);

    const res = await POST(post({ question: "如何校準？" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const events = parseSse(await readSse(res));
    expect(events[0]?.event).toBe("sources");
    expect((events[0]?.data as unknown[]).length).toBe(1);
    // I-04：來源連結帶最深層 heading 錨點（headingPath「章節」→ #<slug>）。
    expect((events[0]?.data as { url: string }[])[0]?.url).toBe(
      `/s/ops/m1#${encodeURIComponent(slugifyHeadingText("章節"))}`,
    );

    const deltas = events.filter((e) => e.event === "delta").map((e) => (e.data as { text: string }).text);
    expect(deltas).toEqual(["雷射", "校準"]);

    const done = events.at(-1)!;
    expect(done.event).toBe("done");
    expect(done.data).toEqual({ usage: { inputTokens: 40, outputTokens: 9 } });
    expect(provider.chatStreamCalls).toBe(1);
  });

  it("無結果：sources:[] + 固定訊息 + done，且不呼叫 LLM", async () => {
    const provider = new FakeProvider();
    getLlmProvider.mockReturnValue(provider);
    retrieve.mockResolvedValue([]);

    const events = parseSse(await readSse(await POST(post({ question: "查無此題" }))));
    expect(events.map((e) => e.event)).toEqual(["sources", "delta", "done"]);
    expect(events[0]?.data).toEqual([]);
    expect((events[1]?.data as { text: string }).text).toBe("知識庫中找不到相關資訊。");
    expect(events[2]?.data).toEqual({ usage: { inputTokens: 0, outputTokens: 0 } });
    // 出貨閘門：無依據不打 LLM。
    expect(provider.chatStreamCalls).toBe(0);
  });

  it("有結果：串流結束後記一筆 ai.query 用量（model/tokens/latency/mode，I-06）", async () => {
    const provider = new FakeProvider(["答"], { inputTokens: 40, outputTokens: 9 }, "gpt-x");
    getLlmProvider.mockReturnValue(provider);
    retrieve.mockResolvedValue([chunk()]);

    await readSse(await POST(post({ question: "如何校準？" })));

    await vi.waitFor(() => expect(recordAiUsage).toHaveBeenCalledTimes(1));
    const arg = recordAiUsage.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      actorId: "user-1",
      model: "gpt-x",
      inputTokens: 40,
      outputTokens: 9,
      mode: "chat",
      ip: "10.0.0.1",
    });
    expect(typeof arg.latencyMs).toBe("number");
  });

  it("無結果：不記 ai.query 用量（未呼叫 LLM）", async () => {
    getLlmProvider.mockReturnValue(new FakeProvider());
    retrieve.mockResolvedValue([]);

    await readSse(await POST(post({ question: "查無此題" })));
    // 讓 stream 完整結束後再斷言（無結果路徑不呼叫 recordAiUsage）。
    await new Promise((r) => setTimeout(r, 10));
    expect(recordAiUsage).not.toHaveBeenCalled();
  });
});
