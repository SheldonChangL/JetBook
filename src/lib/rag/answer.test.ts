import { describe, expect, it } from "vitest";
import type { ChatDelta, ChatParams, ChatResult, ChatUsage, LLMProvider } from "@/lib/llm";
import type { Actor } from "@/lib/authz/permission";
import { slugifyHeadingText } from "@/lib/content/heading-slug";
import {
  ANSWER_MAX_TOKENS,
  SYSTEM_PROMPT,
  buildSources,
  buildUserPrompt,
  headingAnchor,
  streamChatAnswer,
  type SseEvent,
} from "./answer";
import { HEADING_PATH_SEPARATOR } from "./chunker";
import type { RetrievedChunk } from "./retriever";

const actor: Actor = { id: "user-1", orgRole: "member" };

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    pageId: "page-1",
    chunkIndex: 0,
    headingPath: ["安裝", "需求"].join(HEADING_PATH_SEPARATOR),
    chunkText: "雷射系統需在 20±2°C 環境運作，並預熱 30 分鐘。",
    score: 0.5,
    title: "雷射操作手冊",
    spaceSlug: "ops",
    spaceName: "維運空間",
    pageSlug: "laser-manual",
    ...overrides,
  };
}

/** 由頁面 slug 與 headingPath 組出預期的來源連結（與實作同一 slug/編碼規則）。 */
function expectedUrl(spaceSlug: string, pageSlug: string, headingPath: string): string {
  const anchor = headingAnchor(headingPath);
  return anchor ? `/s/${spaceSlug}/${pageSlug}#${encodeURIComponent(anchor)}` : `/s/${spaceSlug}/${pageSlug}`;
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
  it("依順序編號並組出帶錨點的站內連結與摘要", () => {
    const sources = buildSources([
      chunk({ title: "甲", spaceSlug: "s1", pageSlug: "p1" }),
      chunk({ pageId: "page-2", title: "乙", spaceSlug: "s2", pageSlug: "p2", chunkText: "乙內容" }),
    ]);
    expect(sources).toHaveLength(2);
    // headingPath 末段 = 「需求」→ 錨點 slug（與 G-05 閱讀頁標題 id 同規則）。
    expect(sources[0]).toMatchObject({
      n: 1,
      title: "甲",
      url: expectedUrl("s1", "p1", chunk().headingPath),
      pageId: "page-1",
    });
    expect(sources[0]?.url).toContain(`#${encodeURIComponent("需求")}`);
    expect(sources[1]).toMatchObject({
      n: 2,
      title: "乙",
      url: expectedUrl("s2", "p2", chunk().headingPath),
      pageId: "page-2",
    });
    expect(sources[0]?.snippet).toContain("雷射系統");
  });

  it("超長內容截斷為摘要並加省略號", () => {
    const long = "字".repeat(400);
    const [source] = buildSources([chunk({ chunkText: long })]);
    expect(source?.snippet.length).toBeLessThanOrEqual(161);
    expect(source?.snippet.endsWith("…")).toBe(true);
  });
});

describe("headingAnchor / buildSources 引用跳轉錨點（I-04，F-AI-05）", () => {
  it("取最深層 heading 並以 slugifyHeadingText 產生錨點（與 G-05 閱讀頁 id 同規則）", () => {
    const headingPath = ["第一章 背景", "1.2 系統需求", "溫控條件"].join(HEADING_PATH_SEPARATOR);
    expect(headingAnchor(headingPath)).toBe(slugifyHeadingText("溫控條件"));
  });

  it("單層 headingPath 直接取該標題", () => {
    expect(headingAnchor("光軸校準")).toBe(slugifyHeadingText("光軸校準"));
  });

  it("headingPath 為空 → 無錨點，url 退化為頁面頂部", () => {
    expect(headingAnchor("")).toBeNull();
    const [source] = buildSources([chunk({ headingPath: "", spaceSlug: "ops", pageSlug: "top" })]);
    expect(source?.url).toBe("/s/ops/top");
  });

  it("忽略空白／空段，取最後一個有效層級", () => {
    const headingPath = ["  ", "安裝流程", "   "].join(HEADING_PATH_SEPARATOR);
    expect(headingAnchor(headingPath)).toBe(slugifyHeadingText("安裝流程"));
  });

  it("錨點於 url 中經 encodeURIComponent 編碼（CJC 標題可解回原 slug）", () => {
    const [source] = buildSources([
      chunk({ headingPath: "散熱系統 › 風道設計", spaceSlug: "hw", pageSlug: "cooling" }),
    ]);
    const slug = slugifyHeadingText("風道設計");
    expect(source?.url).toBe(`/s/hw/cooling#${encodeURIComponent(slug)}`);
    // AnchorHighlight（G-05）以 decodeURIComponent 反解 hash → 應等於 slug（heading id）。
    const hash = new URL(`http://x${source!.url}`).hash.slice(1);
    expect(decodeURIComponent(hash)).toBe(slug);
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
