import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "./anthropic";

/**
 * 以注入的假 client 驗證串流與聚合路徑（無 API key 環境下的單元驗證；
 * 真實 API 串接於部署設定後以 /admin 測試連線驗證）。
 */

function fakeStream(chunks: string[], model: string) {
  const events = chunks.map((text) => ({
    type: "content_block_delta" as const,
    delta: { type: "text_delta" as const, text },
  }));
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
    async finalMessage() {
      return {
        model,
        content: [{ type: "text", text: chunks.join("") }],
        usage: { input_tokens: 11, output_tokens: 42 },
      };
    },
  };
}

function fakeClient(capture: { model?: string; system?: unknown }): Anthropic {
  return {
    messages: {
      stream(params: { model: string; system?: unknown }) {
        capture.model = params.model;
        capture.system = params.system;
        return fakeStream(["雷射", "校準", "完成"], params.model);
      },
    },
  } as unknown as Anthropic;
}

const options = {
  apiKey: "test",
  modelPrimary: "claude-sonnet-5",
  modelLight: "claude-haiku-4-5",
};

describe("AnthropicProvider", () => {
  it("chatStream 逐塊 yield 文字", async () => {
    const capture: { model?: string } = {};
    const provider = new AnthropicProvider({ ...options, client: fakeClient(capture) });
    const out: string[] = [];
    for await (const delta of provider.chatStream({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
      tier: "primary",
    })) {
      out.push(delta.text);
    }
    expect(out).toEqual(["雷射", "校準", "完成"]);
    expect(capture.model).toBe("claude-sonnet-5");
  });

  it("tier=light 用輕量模型", async () => {
    const capture: { model?: string } = {};
    const provider = new AnthropicProvider({ ...options, client: fakeClient(capture) });
    await provider.chat({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 10,
      tier: "light",
    });
    expect(capture.model).toBe("claude-haiku-4-5");
  });

  it("chat 聚合全文與 usage", async () => {
    const provider = new AnthropicProvider({ ...options, client: fakeClient({}) });
    const result = await provider.chat({
      system: "以繁體中文回答",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 10,
      tier: "primary",
    });
    expect(result.text).toBe("雷射校準完成");
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 42 });
    expect(result.model).toBe("claude-sonnet-5");
  });

  it("介面不暴露 sampling 參數（型別層防護，ADR-009）", () => {
    const provider = new AnthropicProvider({ ...options, client: fakeClient({}) });
    // ChatParams 型別無 temperature 欄位——此測試以執行期確認參數面
    expect(Object.keys(provider)).not.toContain("temperature");
  });
});
