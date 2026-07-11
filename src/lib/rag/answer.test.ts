import { describe, expect, it } from "vitest";
import type { ChatDelta, ChatParams, ChatResult, ChatUsage, LLMProvider } from "@/lib/llm";
import type { Actor } from "@/lib/authz/permission";
import {
  ANSWER_MAX_TOKENS,
  SYSTEM_PROMPT,
  buildSources,
  buildUserPrompt,
  streamChatAnswer,
  type SseEvent,
} from "./answer";
import type { RetrievedChunk } from "./retriever";

const actor: Actor = { id: "user-1", orgRole: "member" };

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    pageId: "page-1",
    chunkIndex: 0,
    headingPath: "安裝 > 需求",
    chunkText: "雷射系統需在 20±2°C 環境運作，並預熱 30 分鐘。",
    score: 0.5,
    title: "雷射操作手冊",
    spaceSlug: "ops",
    spaceName: "維運空間",
    pageSlug: "laser-manual",
    ...overrides,
  };
}

/** 記錄 chatStream 呼叫次數與參數的假 provider。 */
class FakeProvider implements LLMProvider {
  readonly name = "fake";
  chatStreamCalls = 0;
  lastParams: ChatParams | null = null;
  constructor(
    private deltas: string[] = ["答案"],
    private usage: ChatUsage = { inputTokens: 12, outputTokens: 8 },
  ) {}

  async *chatStream(params: ChatParams): AsyncGenerator<ChatDelta, ChatUsage> {
    this.chatStreamCalls += 1;
    this.lastParams = params;
    for (const text of this.deltas) yield { type: "text", text };
    return this.usage;
  }

  async chat(): Promise<ChatResult> {
    throw new Error("未使用");
  }
}

async function collect(gen: AsyncGenerator<SseEvent>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("buildSources", () => {
  it("依順序編號並組出站內連結與摘要", () => {
    const sources = buildSources([
      chunk({ title: "甲", spaceSlug: "s1", pageSlug: "p1" }),
      chunk({ pageId: "page-2", title: "乙", spaceSlug: "s2", pageSlug: "p2", chunkText: "乙內容" }),
    ]);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({ n: 1, title: "甲", url: "/s/s1/p1", pageId: "page-1" });
    expect(sources[1]).toMatchObject({ n: 2, title: "乙", url: "/s/s2/p2", pageId: "page-2" });
    expect(sources[0]?.snippet).toContain("雷射系統");
  });

  it("超長內容截斷為摘要並加省略號", () => {
    const long = "字".repeat(400);
    const [source] = buildSources([chunk({ chunkText: long })]);
    expect(source?.snippet.length).toBeLessThanOrEqual(161);
    expect(source?.snippet.endsWith("…")).toBe(true);
  });
});

describe("buildUserPrompt", () => {
  it("編號與 buildSources 一致並帶入問題", () => {
    const chunks = [chunk({ title: "甲" }), chunk({ pageId: "page-2", title: "乙" })];
    const prompt = buildUserPrompt(chunks, "  預熱多久？  ");
    expect(prompt).toContain("[1] 來源：甲");
    expect(prompt).toContain("[2] 來源：乙");
    expect(prompt).toContain("問題：預熱多久？");
    expect(prompt).not.toContain("  預熱多久？  ");
  });
});

describe("streamChatAnswer — 有檢索結果", () => {
  it("送出 sources → delta* → done(usage) 事件序並呼叫 LLM", async () => {
    const provider = new FakeProvider(["雷射", "校準", "完成"], { inputTokens: 30, outputTokens: 5 });
    const events = await collect(
      streamChatAnswer({
        actor,
        question: "如何校準？",
        noResultsMessage: "查無",
        retrieveFn: async () => [chunk()],
        provider,
      }),
    );

    expect(events[0]?.event).toBe("sources");
    expect((events[0] as Extract<SseEvent, { event: "sources" }>).data).toHaveLength(1);
    const deltas = events.filter((e) => e.event === "delta");
    expect(deltas.map((d) => (d as Extract<SseEvent, { event: "delta" }>).data.text)).toEqual([
      "雷射",
      "校準",
      "完成",
    ]);
    const done = events.at(-1) as Extract<SseEvent, { event: "done" }>;
    expect(done.event).toBe("done");
    expect(done.data.usage).toEqual({ inputTokens: 30, outputTokens: 5 });

    // prompt 正確組裝：system 指示 + 帶編號 user prompt + primary tier + max tokens。
    expect(provider.chatStreamCalls).toBe(1);
    expect(provider.lastParams?.system).toBe(SYSTEM_PROMPT);
    expect(provider.lastParams?.tier).toBe("primary");
    expect(provider.lastParams?.maxTokens).toBe(ANSWER_MAX_TOKENS);
    expect(provider.lastParams?.messages[0]?.content).toContain("[1] 來源：");
    expect(provider.lastParams?.messages[0]?.content).toContain("如何校準？");
  });

  it("AbortSignal 貫通至 LLM 串流", async () => {
    const provider = new FakeProvider();
    const ac = new AbortController();
    await collect(
      streamChatAnswer({
        actor,
        question: "問",
        noResultsMessage: "查無",
        signal: ac.signal,
        retrieveFn: async () => [chunk()],
        provider,
      }),
    );
    expect(provider.lastParams?.signal).toBe(ac.signal);
  });
});

describe("streamChatAnswer — 無檢索結果", () => {
  it("送 sources:[] + 固定訊息 delta + done，且完全不呼叫 LLM", async () => {
    const provider = new FakeProvider();
    const events = await collect(
      streamChatAnswer({
        actor,
        question: "不存在的問題",
        noResultsMessage: "知識庫中找不到相關資訊。",
        retrieveFn: async () => [],
        provider,
      }),
    );

    expect(events).toEqual<SseEvent[]>([
      { event: "sources", data: [] },
      { event: "delta", data: { text: "知識庫中找不到相關資訊。" } },
      { event: "done", data: { usage: { inputTokens: 0, outputTokens: 0 } } },
    ]);
    // 出貨閘門精神：無依據不打 LLM（呼叫數 = 0）。
    expect(provider.chatStreamCalls).toBe(0);
  });
});
