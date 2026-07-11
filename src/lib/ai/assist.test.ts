import { describe, expect, it } from "vitest";
import type { ChatDelta, ChatParams, ChatResult, ChatUsage, LLMProvider } from "@/lib/llm";
import { ASSIST_MODES } from "./assist-modes";
import { buildAssistSystemPrompt, streamAssist } from "./assist";

/**
 * 寫作輔助 prompt 組裝與串流編排單元測試（純邏輯，不打真 LLM）。
 */

class FakeProvider implements LLMProvider {
  readonly name = "fake";
  lastParams: ChatParams | null = null;
  constructor(
    private deltas: string[] = ["結果"],
    private usage: ChatUsage = { inputTokens: 12, outputTokens: 4 },
  ) {}
  async *chatStream(params: ChatParams): AsyncGenerator<ChatDelta, ChatUsage> {
    this.lastParams = params;
    for (const text of this.deltas) yield { type: "text", text };
    return this.usage;
  }
  async chat(): Promise<ChatResult> {
    throw new Error("未使用");
  }
}

async function collect(gen: AsyncGenerator<{ event: string; data: unknown }>) {
  const out: { event: string; data: unknown }[] = [];
  for await (const evt of gen) out.push(evt);
  return out;
}

describe("buildAssistSystemPrompt", () => {
  it("每個模式都產生非空且含共同前導的 system prompt", () => {
    for (const mode of ASSIST_MODES) {
      const prompt = buildAssistSystemPrompt(mode);
      expect(prompt).toContain("只輸出處理後的文字本身");
      expect(prompt.length).toBeGreaterThan(40);
    }
  });

  it("translate_en 指示翻譯成英文；其餘保留原文語言", () => {
    expect(buildAssistSystemPrompt("translate_en")).toContain("翻譯成");
    expect(buildAssistSystemPrompt("fix")).toContain("修正");
    expect(buildAssistSystemPrompt("concise")).toContain("精簡");
  });
});

describe("streamAssist", () => {
  it("以 light tier 逐塊 delta → done(usage)", async () => {
    const provider = new FakeProvider(["更", "精簡"], { inputTokens: 30, outputTokens: 7 });
    const events = await collect(
      streamAssist({ mode: "concise", text: "  請把這段變精簡  ", provider }),
    );

    expect(events.map((e) => e.event)).toEqual(["delta", "delta", "done"]);
    expect((events[0]?.data as { text: string }).text).toBe("更");
    expect((events[1]?.data as { text: string }).text).toBe("精簡");
    expect(events[2]?.data).toEqual({ usage: { inputTokens: 30, outputTokens: 7 } });

    // 輕量任務用 light tier；system 帶模式指示；user 為 trim 後原文。
    expect(provider.lastParams?.tier).toBe("light");
    expect(provider.lastParams?.system).toContain("精簡");
    expect(provider.lastParams?.messages[0]?.content).toBe("請把這段變精簡");
  });

  it("signal 貫通至 provider（供 client 斷線停止生成）", async () => {
    const provider = new FakeProvider();
    const controller = new AbortController();
    await collect(
      streamAssist({ mode: "rewrite", text: "x", provider, signal: controller.signal }),
    );
    expect(provider.lastParams?.signal).toBe(controller.signal);
  });
});
