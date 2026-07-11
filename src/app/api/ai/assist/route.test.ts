import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatDelta,
  ChatParams,
  ChatResult,
  ChatStreamResult,
  ChatUsage,
  LLMProvider,
} from "@/lib/llm";

/**
 * Route 層測試（薄殼 + 真實 streamAssist 編排）：只 mock 邊界
 * （session / llm 設定 / 權限 / rate limit / i18n），走真實 streamAssist 與 SSE 編碼，
 * 驗證狀態碼、事件序、tier=light 與 F-AI-08「永不直接覆寫」由前端把關（此處只驗串流不落地）。
 */

const messages: Record<string, string> = {
  disabled: "AI 功能未啟用",
  unauthorized: "需登入",
  invalidRequest: "問題內容不正確",
  forbidden: "沒有編輯此頁面的權限",
  rateLimited: "AI 請求過於頻繁，請稍後再試",
  failed: "AI 產生失敗，請稍後再試",
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

const canEditPage = vi.fn();
vi.mock("@/lib/authz/permission", () => ({
  canEditPage: (...args: unknown[]) => canEditPage(...args),
}));

const rateCheck = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  aiRateLimiter: { check: (...args: unknown[]) => rateCheck(...args) },
}));

// audit（server-only + DB）：只需 ipFromHeaders，不觸 DB。
vi.mock("@/lib/audit", () => ({
  ipFromHeaders: () => "10.0.0.2",
}));

const recordAiUsage = vi.fn();
vi.mock("@/lib/ai/usage", () => ({
  recordAiUsage: (...args: unknown[]) => recordAiUsage(...args),
}));

import { POST } from "./route";

class FakeProvider implements LLMProvider {
  readonly name = "fake";
  chatStreamCalls = 0;
  lastParams: ChatParams | null = null;
  constructor(
    private deltas: string[] = ["結果"],
    private usage: ChatUsage = { inputTokens: 10, outputTokens: 3 },
    private modelId = "fake-model",
  ) {}
  async *chatStream(params: ChatParams): AsyncGenerator<ChatDelta, ChatStreamResult> {
    this.lastParams = params;
    this.chatStreamCalls += 1;
    for (const text of this.deltas) yield { type: "text", text };
    return { usage: this.usage, model: this.modelId };
  }
  async chat(): Promise<ChatResult> {
    throw new Error("未使用");
  }
}

const PAGE_ID = "11111111-1111-4111-8111-111111111111";

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

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
  canEditPage.mockResolvedValue(true);
  rateCheck.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
});

describe("POST /api/ai/assist", () => {
  it("未登入回 401", async () => {
    getCurrentSession.mockResolvedValue(null);
    const res = await POST(post({ mode: "concise", text: "hi", pageId: PAGE_ID }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("AI 未設定回 503 AI_DISABLED", async () => {
    isLlmConfigured.mockReturnValue(false);
    const res = await POST(post({ mode: "concise", text: "hi", pageId: PAGE_ID }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("AI_DISABLED");
  });

  it("未知模式回 400", async () => {
    const res = await POST(post({ mode: "summarize", text: "hi", pageId: PAGE_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("空白文字回 400", async () => {
    const res = await POST(post({ mode: "fix", text: "   ", pageId: PAGE_ID }));
    expect(res.status).toBe(400);
  });

  it("pageId 非 uuid 回 400", async () => {
    const res = await POST(post({ mode: "fix", text: "hi", pageId: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  it("無編輯權限回 403 FORBIDDEN，且不打 LLM", async () => {
    canEditPage.mockResolvedValue(false);
    const provider = new FakeProvider();
    getLlmProvider.mockReturnValue(provider);
    const res = await POST(post({ mode: "formal", text: "hi", pageId: PAGE_ID }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
    expect(provider.chatStreamCalls).toBe(0);
  });

  it("超過速率限制回 429 並帶 Retry-After", async () => {
    rateCheck.mockReturnValue({ allowed: false, retryAfterSeconds: 42 });
    const res = await POST(post({ mode: "rewrite", text: "hi", pageId: PAGE_ID }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });

  it("成功：SSE delta → done(usage)，以 light tier 呼叫", async () => {
    const provider = new FakeProvider(["更", "正式"], { inputTokens: 22, outputTokens: 5 }, "light-x");
    getLlmProvider.mockReturnValue(provider);

    const res = await POST(post({ mode: "formal", text: "把這句變正式", pageId: PAGE_ID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const events = parseSse(await readSse(res));
    const deltas = events.filter((e) => e.event === "delta").map((e) => (e.data as { text: string }).text);
    expect(deltas).toEqual(["更", "正式"]);
    const done = events.at(-1)!;
    expect(done.event).toBe("done");
    expect(done.data).toEqual({ usage: { inputTokens: 22, outputTokens: 5 } });
    expect(provider.chatStreamCalls).toBe(1);
    expect(provider.lastParams?.tier).toBe("light");
    // rate limit key 以使用者 id 命名空間隔離
    expect(rateCheck).toHaveBeenCalledWith("assist:user-1");

    // 串流結束後記一筆 ai.query 用量（mode=assist、model/tokens/latency，I-06）。
    await vi.waitFor(() => expect(recordAiUsage).toHaveBeenCalledTimes(1));
    const arg = recordAiUsage.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      actorId: "user-1",
      model: "light-x",
      inputTokens: 22,
      outputTokens: 5,
      mode: "assist",
      ip: "10.0.0.2",
    });
    expect(typeof arg.latencyMs).toBe("number");
  });

  it("無編輯權限（403）：不記 ai.query 用量", async () => {
    canEditPage.mockResolvedValue(false);
    getLlmProvider.mockReturnValue(new FakeProvider());
    await POST(post({ mode: "formal", text: "hi", pageId: PAGE_ID }));
    expect(recordAiUsage).not.toHaveBeenCalled();
  });
});
