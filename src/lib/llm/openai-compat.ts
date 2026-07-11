import "server-only";
import { logger } from "@/lib/logger";
import type { ChatDelta, ChatParams, ChatResult, ChatStreamResult, ChatUsage, LLMProvider } from "./provider";

export interface OpenAICompatProviderOptions {
  baseUrl: string;
  modelPrimary: string;
  modelLight: string;
}

interface CompletionChunk {
  choices?: { delta?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  model?: string;
}

interface StreamMeta {
  usage: ChatUsage;
  model: string;
}

/**
 * OpenAI-compatible 實作（H-03；Ollama/vLLM/LM Studio，NFR-COMP-01 Local LLM 路線）。
 * POST {base}/v1/chat/completions（stream:true，SSE `data:` 行解析）。
 * 切換方式：LLM_PROVIDER=openai-compat + OPENAI_COMPAT_* env，不改任何呼叫端程式碼。
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly name = "openai-compat";

  constructor(private options: OpenAICompatProviderOptions) {}

  private model(tier: ChatParams["tier"]): string {
    return tier === "primary" ? this.options.modelPrimary : this.options.modelLight;
  }

  /** 內部串流：yield 文字增量，generator return 帶回 usage/model。 */
  private async *streamInternal(params: ChatParams): AsyncGenerator<ChatDelta, StreamMeta> {
    const response = await fetch(`${this.options.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model(params.tier),
        max_tokens: params.maxTokens,
        stream: true,
        // include_usage：vLLM/Ollama 於最後 chunk 回報 usage；不支援者忽略
        stream_options: { include_usage: true },
        messages: [
          ...(params.system ? [{ role: "system" as const, content: params.system }] : []),
          ...params.messages,
        ],
      }),
      signal: params.signal ?? null,
    });
    if (!response.ok || !response.body) {
      throw new Error(`openai-compat 回應異常：HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: CompletionChunk["usage"] = null;
    let model = this.model(params.tier);

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE：逐行解析 "data: {...}"／"data: [DONE]"
        for (;;) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex === -1) break;
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let chunk: CompletionChunk;
          try {
            chunk = JSON.parse(payload) as CompletionChunk;
          } catch {
            continue; // 非 JSON（部分實作的註解/心跳行）忽略
          }
          if (chunk.model) model = chunk.model;
          if (chunk.usage) usage = chunk.usage;
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield { type: "text", text };
        }
      }
    } finally {
      reader.releaseLock();
    }

    const meta: StreamMeta = {
      model,
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
      },
    };
    logger.info(
      { provider: this.name, model: meta.model, ...meta.usage },
      "llm usage",
    );
    return meta;
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatDelta, ChatStreamResult> {
    // 回傳 usage + model（I-06 用量記錄需 model 分項）；StreamMeta 即 ChatStreamResult。
    return yield* this.streamInternal(params);
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const generator = this.streamInternal(params);
    let text = "";
    for (;;) {
      const step = await generator.next();
      if (step.done) {
        return { text, model: step.value.model, usage: step.value.usage };
      }
      text += step.value.text;
    }
  }
}
