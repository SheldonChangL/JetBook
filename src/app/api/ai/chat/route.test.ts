import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationChatSummary, ConversationSseEvent } from "@/lib/ai/conversation-chat";

/**
 * Route 層測試（薄殼）：只驗證邊界與串接——驗 session／AI 設定／限流／body、續談擁有者
 * 驗證（getConversation）、把 runConversationChat 的事件序編碼為 SSE、並在有 LLM 用量時
 * 記一筆 ai.query。多輪編排本身（rewrite／history／持久化）在 conversation-chat.test.ts。
 */

const messages: Record<string, string> = {
  noResults: "知識庫中找不到相關資訊。",
  disabled: "AI 功能未啟用",
  unauthorized: "需登入",
  invalidRequest: "問題內容不正確",
  failed: "AI 回答產生失敗，請稍後再試",
  conversationNotFound: "找不到對話或無權存取",
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

const getConversation = vi.fn();
vi.mock("@/lib/ai/conversations", () => ({
  getConversation: (...args: unknown[]) => getConversation(...args),
}));

const runConversationChat = vi.fn();
vi.mock("@/lib/ai/conversation-chat", () => ({
  runConversationChat: (...args: unknown[]) => runConversationChat(...args),
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

/** 建一個依 events 逐一 yield、結束回傳 summary 的假 runConversationChat 產生器。 */
function fakeGen(
  events: ConversationSseEvent[],
  summary: ConversationChatSummary,
): AsyncGenerator<ConversationSseEvent, ConversationChatSummary> {
  async function* gen() {
    for (const e of events) yield e;
    return summary;
  }
  return gen();
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
  getLlmProvider.mockReturnValue({ name: "fake" });
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

  it("續談 conversationId 非本人/不存在回 404，且不呼叫 runConversationChat", async () => {
    getConversation.mockResolvedValue(null);
    const cid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const res = await POST(post({ question: "hi", conversationId: cid }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect(getConversation).toHaveBeenCalledWith("user-1", cid);
    expect(runConversationChat).not.toHaveBeenCalled();
  });

  it("首問：SSE 事件序 conversation → sources → delta → done，並記一筆 ai.query 用量", async () => {
    const events: ConversationSseEvent[] = [
      { event: "conversation", data: { id: "conv-1" } },
      { event: "sources", data: [] },
      { event: "delta", data: { text: "答案" } },
      { event: "done", data: { usage: { inputTokens: 40, outputTokens: 9 } } },
    ];
    runConversationChat.mockReturnValue(
      fakeGen(events, { conversationId: "conv-1", usage: { inputTokens: 40, outputTokens: 9 }, model: "gpt-x" }),
    );

    const res = await POST(post({ question: "如何校準？" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const seq = parseSse(await readSse(res));
    expect(seq.map((e) => e.event)).toEqual(["conversation", "sources", "delta", "done"]);
    expect(seq[0]?.data).toEqual({ id: "conv-1" });

    // 首問無 conversationId → 不做擁有者查詢。
    expect(getConversation).not.toHaveBeenCalled();
    const arg = runConversationChat.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.conversationId).toBeUndefined();
    expect(arg.question).toBe("如何校準？");

    await vi.waitFor(() => expect(recordAiUsage).toHaveBeenCalledTimes(1));
    expect(recordAiUsage.mock.calls[0]![0]).toMatchObject({
      actorId: "user-1",
      model: "gpt-x",
      inputTokens: 40,
      outputTokens: 9,
      mode: "chat",
      ip: "10.0.0.1",
    });
  });

  it("無 LLM 用量（usage/model 為 null）時不記 ai.query", async () => {
    const events: ConversationSseEvent[] = [
      { event: "conversation", data: { id: "conv-2" } },
      { event: "sources", data: [] },
      { event: "delta", data: { text: "知識庫中找不到相關資訊。" } },
      { event: "done", data: { usage: { inputTokens: 0, outputTokens: 0 } } },
    ];
    runConversationChat.mockReturnValue(
      fakeGen(events, { conversationId: "conv-2", usage: null, model: null }),
    );

    await readSse(await POST(post({ question: "查無此題" })));
    await new Promise((r) => setTimeout(r, 10));
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it("續談：驗擁有者後以對話 spaceId 續談（body spaceId 被對話快照覆蓋）", async () => {
    const cid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    getConversation.mockResolvedValue({ id: cid, title: "t", spaceId: "space-A" });
    runConversationChat.mockReturnValue(
      fakeGen(
        [
          { event: "conversation", data: { id: cid } },
          { event: "sources", data: [] },
          { event: "delta", data: { text: "續" } },
          { event: "done", data: { usage: { inputTokens: 1, outputTokens: 1 } } },
        ],
        { conversationId: cid, usage: { inputTokens: 1, outputTokens: 1 }, model: "m" },
      ),
    );

    const bodySpaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await readSse(
      await POST(post({ question: "追問", conversationId: cid, spaceId: bodySpaceId })),
    );

    expect(getConversation).toHaveBeenCalledWith("user-1", cid);
    const arg = runConversationChat.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.conversationId).toBe(cid);
    // 續談沿用對話快照的 spaceId（space-A），而非 body 的 spaceId。
    expect(arg.spaceId).toBe("space-A");
  });
});
