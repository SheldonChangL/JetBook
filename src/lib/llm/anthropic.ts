import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/logger";
import type { ChatDelta, ChatParams, ChatResult, LLMProvider } from "./provider";

export interface AnthropicProviderOptions {
  apiKey: string;
  modelPrimary: string;
  modelLight: string;
  /** 測試注入用；未提供則以 apiKey 建立官方 client */
  client?: Anthropic;
}

/**
 * Anthropic 實作（前期 provider，B.8）。
 * - 一律 streaming（避免長回應 HTTP timeout）；chat() 內部聚合串流。
 * - usage 記入 log（NFR-OBS-04 metrics 於 N-05 接手）。
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private models: { primary: string; light: string };

  constructor(options: AnthropicProviderOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    this.models = { primary: options.modelPrimary, light: options.modelLight };
  }

  private model(tier: ChatParams["tier"]): string {
    return this.models[tier];
  }

  async *chatStream(params: ChatParams): AsyncIterable<ChatDelta> {
    const stream = this.client.messages.stream(
      {
        model: this.model(params.tier),
        max_tokens: params.maxTokens,
        ...(params.system ? { system: params.system } : {}),
        messages: params.messages,
      },
      params.signal ? { signal: params.signal } : undefined,
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    logger.info(
      {
        provider: this.name,
        model: final.model,
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      },
      "llm usage",
    );
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const stream = this.client.messages.stream(
      {
        model: this.model(params.tier),
        max_tokens: params.maxTokens,
        ...(params.system ? { system: params.system } : {}),
        messages: params.messages,
      },
      params.signal ? { signal: params.signal } : undefined,
    );
    const final = await stream.finalMessage();
    const text = final.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    logger.info(
      {
        provider: this.name,
        model: final.model,
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      },
      "llm usage",
    );
    return {
      text,
      model: final.model,
      usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
    };
  }
}
