import "server-only";
import { env } from "@/lib/env";
import {
  getEmbeddingProvider,
  getLlmProvider,
  isEmbeddingConfigured,
  isLlmConfigured,
} from "./index";
import type { EmbeddingProvider, LLMProvider } from "./provider";

/**
 * AI 連線設定唯讀摘要與連線測試（L-03，F-ADMIN-04；C6）。
 *
 * - 連線設定一律來自環境變數（12-factor，NFR-MAINT-05／NFR-COMP-01）：本模組只讀
 *   `@/lib/env`，不提供任何寫入路徑，UI 亦不得出現可編輯欄位或 sampling 參數。
 * - API key 一律遮罩：只保留末四碼供辨識，其餘不外洩（image／log／畫面皆同）。
 * - 連線測試對已設定的 provider 實打一次最小請求（chat／embed），成功回 ok、
 *   失敗回可讀錯誤原因（供 admin 診斷）。
 */

export interface LlmConnectionSummary {
  /** 是否已設定 LLM_PROVIDER */
  configured: boolean;
  provider: "anthropic" | "openai-compat" | null;
  /** 主力生成 tier 的實際 model id */
  modelPrimary: string | null;
  /** 輕量任務 tier 的實際 model id */
  modelLight: string | null;
  /** OpenAI-compatible 端點 Base URL；anthropic 為 null */
  baseUrl: string | null;
  /** API key 末四碼（遮罩）；無 key（如本機 openai-compat）為 null */
  apiKeyLast4: string | null;
}

export interface EmbeddingConnectionSummary {
  /** 是否已設定 EMBEDDING_BASE_URL */
  configured: boolean;
  baseUrl: string | null;
  model: string;
  dimensions: number;
}

export interface AiSettingsSummary {
  llm: LlmConnectionSummary;
  embedding: EmbeddingConnectionSummary;
}

/**
 * 遮罩 API key：僅保留末四碼（`••••1234`）。長度過短（< 8）一律全遮，避免短 key 外洩。
 * 未設定回 null。
 */
export function maskApiKeyLast4(key: string | undefined | null): string | null {
  if (!key) return null;
  if (key.length < 8) return "••••••••";
  return `••••${key.slice(-4)}`;
}

/** 唯讀連線設定摘要（全部來自 env；秘密遮罩）。 */
export function getAiSettingsSummary(): AiSettingsSummary {
  const provider = env.LLM_PROVIDER ?? null;

  let llm: LlmConnectionSummary;
  if (provider === "anthropic") {
    llm = {
      configured: true,
      provider,
      modelPrimary: env.ANTHROPIC_MODEL_PRIMARY,
      modelLight: env.ANTHROPIC_MODEL_LIGHT,
      baseUrl: null,
      apiKeyLast4: maskApiKeyLast4(env.ANTHROPIC_API_KEY),
    };
  } else if (provider === "openai-compat") {
    llm = {
      configured: true,
      provider,
      modelPrimary: env.OPENAI_COMPAT_MODEL_PRIMARY ?? null,
      modelLight: env.OPENAI_COMPAT_MODEL_LIGHT ?? null,
      baseUrl: env.OPENAI_COMPAT_BASE_URL ?? null,
      apiKeyLast4: null,
    };
  } else {
    llm = {
      configured: false,
      provider: null,
      modelPrimary: null,
      modelLight: null,
      baseUrl: null,
      apiKeyLast4: null,
    };
  }

  const embedding: EmbeddingConnectionSummary = {
    configured: isEmbeddingConfigured(),
    baseUrl: env.EMBEDDING_BASE_URL ?? null,
    model: env.EMBEDDING_MODEL,
    dimensions: env.EMBEDDING_DIMENSIONS,
  };

  return { llm, embedding };
}

export type ConnectionTestOutcome =
  | { status: "ok" }
  /** provider 未經 env 設定，無從測試 */
  | { status: "unconfigured" }
  /** 實打失敗；message 為可讀診斷原因（非 i18n，供 admin 檢視） */
  | { status: "error"; message: string };

/** 將任意錯誤轉為安全、可讀且長度受限的診斷訊息（不外洩秘密）。 */
function toDiagnosticMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  const message = trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
  return message || "unknown error";
}

/**
 * LLM 連線測試：對已設定 provider 實打一次最小 chat（light tier、極小 maxTokens）。
 * @param provider 測試注入用；預設取 env 設定的單例。
 */
export async function testLlmConnection(
  provider?: LLMProvider,
): Promise<ConnectionTestOutcome> {
  // 注入 provider 時略過 env 判斷（測試用）；未注入則沿用 env 設定與單例。
  if (!provider && !isLlmConfigured()) return { status: "unconfigured" };
  try {
    const p = provider ?? getLlmProvider();
    await p.chat({ messages: [{ role: "user", content: "ping" }], maxTokens: 4, tier: "light" });
    return { status: "ok" };
  } catch (error) {
    return { status: "error", message: toDiagnosticMessage(error) };
  }
}

/**
 * Embedding 連線測試：對已設定端點實打一次最小 embed（單筆 query）。
 * 維度不符也會在此以錯誤原因暴露（換模型未走 migration 的常見誤設）。
 * @param provider 測試注入用；預設取 env 設定的單例。
 */
export async function testEmbeddingConnection(
  provider?: EmbeddingProvider,
): Promise<ConnectionTestOutcome> {
  // 注入 provider 時略過 env 判斷（測試用）；未注入則沿用 env 設定與單例。
  if (!provider && !isEmbeddingConfigured()) return { status: "unconfigured" };
  try {
    const p = provider ?? getEmbeddingProvider();
    await p.embed(["ping"], "query");
    return { status: "ok" };
  } catch (error) {
    return { status: "error", message: toDiagnosticMessage(error) };
  }
}
