import "server-only";
import { env } from "@/lib/env";
import { AnthropicProvider } from "./anthropic";
import type { LLMProvider } from "./provider";

export type { ChatDelta, ChatMessage, ChatParams, ChatResult, ChatUsage, EmbeddingProvider, LLMProvider } from "./provider";

/** AI 功能是否已設定（UI 依此顯示/隱藏 AI 入口）。 */
export function isLlmConfigured(): boolean {
  return env.LLM_PROVIDER !== undefined;
}

const globalForLlm = globalThis as unknown as { jetbookLlm?: LLMProvider };

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
    case "openai-compat":
      // H-03 實作 OpenAICompatProvider 後在此接上
      throw new Error("openai-compat provider 於 H-03 提供");
    default:
      throw new Error("未設定 LLM_PROVIDER（AI 功能未啟用）");
  }

  globalForLlm.jetbookLlm = provider;
  return provider;
}
