import "server-only";
import { env } from "@/lib/env";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatProvider } from "./openai-compat";
import type { LLMProvider } from "./provider";

import { OpenAICompatEmbeddingProvider } from "./embedding";
import type { EmbeddingProvider } from "./provider";

export type { ChatDelta, ChatMessage, ChatParams, ChatResult, ChatUsage, EmbeddingProvider, LLMProvider } from "./provider";

/** AI 功能是否已設定（UI 依此顯示/隱藏 AI 入口）。 */
export function isLlmConfigured(): boolean {
  return env.LLM_PROVIDER !== undefined;
}

/** 語意索引是否已設定（embedding 管線與語意搜尋依此啟用）。 */
export function isEmbeddingConfigured(): boolean {
  return env.EMBEDDING_BASE_URL !== undefined;
}

const globalForLlm = globalThis as unknown as {
  jetbookLlm?: LLMProvider;
  jetbookEmbedding?: EmbeddingProvider;
};

/** 依 env 產生 Embedding provider 單例（day-1 local BGE-M3，ADR-005）。 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (globalForLlm.jetbookEmbedding) return globalForLlm.jetbookEmbedding;
  if (!env.EMBEDDING_BASE_URL) {
    throw new Error("未設定 EMBEDDING_BASE_URL（語意索引未啟用）");
  }
  const provider = new OpenAICompatEmbeddingProvider({
    baseUrl: env.EMBEDDING_BASE_URL,
    model: env.EMBEDDING_MODEL,
    dimensions: env.EMBEDDING_DIMENSIONS,
    queryPrefix: env.EMBEDDING_QUERY_PREFIX,
  });
  globalForLlm.jetbookEmbedding = provider;
  return provider;
}

/**
 * 依 env 產生 LLM provider 單例（NFR-COMP-01：切換只改環境變數）。
 * openai-compat 實作由 H-03 提供；未設定 provider 時擲出明確錯誤
 * （呼叫端應先以 isLlmConfigured() 判斷，避免讓錯誤外洩到使用者流程）。
 */
export function getLlmProvider(): LLMProvider {
  if (globalForLlm.jetbookLlm) return globalForLlm.jetbookLlm;

  let provider: LLMProvider;
  switch (env.LLM_PROVIDER) {
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("LLM_PROVIDER=anthropic 但未設定 ANTHROPIC_API_KEY");
      }
      provider = new AnthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        modelPrimary: env.ANTHROPIC_MODEL_PRIMARY,
        modelLight: env.ANTHROPIC_MODEL_LIGHT,
      });
      break;
    }
    case "openai-compat": {
      if (
        !env.OPENAI_COMPAT_BASE_URL ||
        !env.OPENAI_COMPAT_MODEL_PRIMARY ||
        !env.OPENAI_COMPAT_MODEL_LIGHT
      ) {
        throw new Error(
          "LLM_PROVIDER=openai-compat 需要 OPENAI_COMPAT_BASE_URL / MODEL_PRIMARY / MODEL_LIGHT",
        );
      }
      provider = new OpenAICompatProvider({
        baseUrl: env.OPENAI_COMPAT_BASE_URL,
        modelPrimary: env.OPENAI_COMPAT_MODEL_PRIMARY,
        modelLight: env.OPENAI_COMPAT_MODEL_LIGHT,
      });
      break;
    }
    default:
      throw new Error("未設定 LLM_PROVIDER（AI 功能未啟用）");
  }

  globalForLlm.jetbookLlm = provider;
  return provider;
}
