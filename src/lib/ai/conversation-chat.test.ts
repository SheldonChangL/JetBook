import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatDelta,
  ChatParams,
  ChatResult,
  ChatStreamResult,
  ChatUsage,
  LLMProvider,
} from "@/lib/llm";
import type { Actor } from "@/lib/authz/permission";
import type { RetrievedChunk } from "@/lib/rag/retriever";

/**
 * 多輪對話編排單元測試（I-07）。以真實 streamChatAnswer + 假 provider + 注入 retrieveFn
 * 驗證：首問建立對話＋標題生成、追問 query rewrite 帶脈絡檢索、無結果不打 LLM、
 * 每輪 user／assistant 訊息（含來源快照）落庫。資料存取層（conversations）以 mock 隔離。
 */

const createConversation = vi.fn();
const loadHistory = vi.fn();
const appendMessage = vi.fn();
const touchConversation = vi.fn();
const updateConversationTitle = vi.fn();

vi.mock("./conversations", () => ({
  createConversation: (...a: unknown[]) => createConversation(...a),
  loadHistory: (...a: unknown[]) => loadHistory(...a),
  appendMessage: (...a: unknown[]) => appendMessage(...a),
  touchConversation: (...a: unknown[]) => touchConversation(...a),
  updateConversationTitle: (...a: unknown[]) => updateConversationTitle(...a),
}));

import {
  QUERY_REWRITE_SYSTEM,
  TITLE_SYSTEM,
  provisionalTitle,
  runConversationChat,
  type ConversationSseEvent,
} from "./conversation-chat";

const actor: Actor = { id: "user-1", orgRole: "member" };

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

/** 假 provider：chatStream 逐 delta；chat 依 system 區分 rewrite／title 回傳。 */
class FakeProvider implements LLMProvider {
  readonly name = "fake";
  chatStreamCalls = 0;
  lastStreamParams: ChatParams | null = null;
  chatCalls: ChatParams[] = [];
  constructor(
    private deltas: string[] = ["答案"],
    private usage: ChatUsage = { inputTokens: 20, outputTokens: 6 },
    private modelId = "fake-model",
    private rewritten = "獨立查詢",
    private title = "生成標題",
  ) {}

  async *chatStream(params: ChatParams): AsyncGenerator<ChatDelta, ChatStreamResult> {
    this.chatStreamCalls += 1;
    this.lastStreamParams = params;
    for (const text of this.deltas) yield { type: "text", text };
    return { usage: this.usage, model: this.modelId };
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    this.chatCalls.push(params);
    const text =
      params.system === QUERY_REWRITE_SYSTEM
        ? this.rewritten
        : params.system === TITLE_SYSTEM
          ? this.title
          : "";
    return { text, usage: { inputTokens: 5, outputTokens: 2 }, model: "light-model" };
  }
}

async function collect(
  gen: AsyncGenerator<ConversationSseEvent, unknown>,
): Promise<{ events: ConversationSseEvent[]; ret: unknown }> {
  const events: ConversationSseEvent[] = [];
  for (;;) {
    const step = await gen.next();
    if (step.done) return { events, ret: step.value };
    events.push(step.value);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  createConversation.mockResolvedValue({ id: "conv-new" });
  loadHistory.mockResolvedValue([]);
  appendMessage.mockResolvedValue(undefined);
  touchConversation.mockResolvedValue(undefined);
  updateConversationTitle.mockResolvedValue(undefined);
});

describe("provisionalTitle", () => {
  it("單行化並截斷過長首問", () => {
    expect(provisionalTitle("  多行\n問題  ")).toBe("多行 問題");
    const long = "字".repeat(100);
    expect(provisionalTitle(long).length).toBe(40);
  });
});

describe("runConversationChat — 首問（新對話）", () => {
  it("建立對話、emit conversation、以原問題檢索、落庫 user/assistant、生成標題", async () => {
    const provider = new FakeProvider(["雷射", "校準"], { inputTokens: 40, outputTokens: 9 }, "gpt-x");
    const retrieveFn = vi.fn(async () => [chunk()]);

    const { events, ret } = await collect(
      runConversationChat({
        actor,
        question: "如何校準？",
        spaceId: "space-1",
        noResultsMessage: "查無",
        provider,
        retrieveFn,
      }),
    );

    // 新對話建立（暫定標題＝截斷首問）並先 emit conversation。
    expect(createConversation).toHaveBeenCalledWith({
      userId: "user-1",
      spaceId: "space-1",
      title: "如何校準？",
    });
    expect(events[0]).toEqual({ event: "conversation", data: { id: "conv-new" } });
    expect(events.map((e) => e.event)).toEqual(["conversation", "sources", "delta", "delta", "done"]);

    // 首問無 rewrite：以原問題檢索。
    expect(retrieveFn).toHaveBeenCalledWith(actor, "如何校準？", { spaceId: "space-1" });
    // 首問無歷史：chatStream messages 僅當前帶 context 的提問。
    expect(provider.lastStreamParams?.messages).toHaveLength(1);
    expect(provider.lastStreamParams?.messages[0]?.content).toContain("[1] 來源：");

    // 落庫：user（無 sources）＋ assistant（帶來源快照）。
    expect(appendMessage).toHaveBeenCalledTimes(2);
    expect(appendMessage.mock.calls[0]![0]).toMatchObject({
      conversationId: "conv-new",
      role: "user",
      content: "如何校準？",
      sources: null,
    });
    const asst = appendMessage.mock.calls[1]![0] as { role: string; content: string; sources: unknown[] };
    expect(asst.role).toBe("assistant");
    expect(asst.content).toBe("雷射校準");
    expect(asst.sources).toHaveLength(1);
    expect(touchConversation).toHaveBeenCalledWith("conv-new");

    // 新對話：light tier 生成標題並回填。
    expect(updateConversationTitle).toHaveBeenCalledWith("conv-new", "生成標題");
    const titleCall = provider.chatCalls.find((c) => c.system === TITLE_SYSTEM);
    expect(titleCall?.tier).toBe("light");

    expect(ret).toEqual({
      conversationId: "conv-new",
      usage: { inputTokens: 40, outputTokens: 9 },
      model: "gpt-x",
    });
  });
});

describe("runConversationChat — 追問（續談）", () => {
  it("載入歷史、query rewrite 改寫後檢索、messages 帶歷史脈絡、不重建對話/不生成標題", async () => {
    loadHistory.mockResolvedValue([
      { role: "user", content: "第一題" },
      { role: "assistant", content: "第一答" },
    ]);
    const provider = new FakeProvider(["跟進答"], { inputTokens: 11, outputTokens: 3 }, "gpt-x", "改寫後查詢");
    const retrieveFn = vi.fn(async () => [chunk()]);

    const { events } = await collect(
      runConversationChat({
        actor,
        question: "那另一個呢？",
        conversationId: "conv-existing",
        noResultsMessage: "查無",
        provider,
        retrieveFn,
      }),
    );

    // 續談不重建對話，但仍 emit conversation（回傳既有 id）。
    expect(createConversation).not.toHaveBeenCalled();
    expect(events[0]).toEqual({ event: "conversation", data: { id: "conv-existing" } });
    expect(loadHistory).toHaveBeenCalledWith("conv-existing");

    // query rewrite（light tier）→ 以改寫後查詢檢索。
    const rewriteCall = provider.chatCalls.find((c) => c.system === QUERY_REWRITE_SYSTEM);
    expect(rewriteCall?.tier).toBe("light");
    expect(retrieveFn).toHaveBeenCalledWith(actor, "改寫後查詢", { spaceId: undefined });

    // chatStream messages = 歷史（2）+ 當前帶 context 的提問（1）。
    expect(provider.lastStreamParams?.messages).toHaveLength(3);
    expect(provider.lastStreamParams?.messages[0]).toEqual({ role: "user", content: "第一題" });
    expect(provider.lastStreamParams?.messages[1]).toEqual({ role: "assistant", content: "第一答" });
    expect(provider.lastStreamParams?.messages[2]?.content).toContain("那另一個呢？");

    // 續談不生成標題。
    expect(updateConversationTitle).not.toHaveBeenCalled();
    expect(appendMessage).toHaveBeenCalledTimes(2);
  });
});

describe("runConversationChat — 無檢索結果", () => {
  it("送固定訊息且不呼叫 LLM 生成；訊息仍落庫（assistant sources 為 null）", async () => {
    const provider = new FakeProvider();
    const retrieveFn = vi.fn(async () => [] as RetrievedChunk[]);

    const { events, ret } = await collect(
      runConversationChat({
        actor,
        question: "查無此題",
        noResultsMessage: "知識庫中找不到相關資訊。",
        provider,
        retrieveFn,
      }),
    );

    expect(events.map((e) => e.event)).toEqual(["conversation", "sources", "delta", "done"]);
    expect(provider.chatStreamCalls).toBe(0); // 出貨閘門：無依據不打 LLM 生成。

    expect(appendMessage).toHaveBeenCalledTimes(2);
    const asst = appendMessage.mock.calls[1]![0] as { role: string; content: string; sources: unknown };
    expect(asst).toMatchObject({
      role: "assistant",
      content: "知識庫中找不到相關資訊。",
      sources: null,
    });
    // 未呼叫 LLM 生成 → usage/model 為 null（route 據此不記 ai.query）。
    expect(ret).toEqual({ conversationId: "conv-new", usage: null, model: null });
  });
});
