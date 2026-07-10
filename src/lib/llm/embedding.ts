import "server-only";
import { logger } from "@/lib/logger";
import type { EmbeddingProvider } from "./provider";

export interface OpenAICompatEmbeddingOptions {
  baseUrl: string;
  model: string;
  dimensions: number;
  /** 部分模型需要 query 前綴（BGE-M3 不需要；留作他型模型的設定鉤子） */
  queryPrefix?: string;
}

interface EmbeddingsResponse {
  data?: { index?: number; embedding?: number[] }[];
  usage?: { prompt_tokens?: number };
}

/**
 * OpenAI-compatible embedding 實作（H-04，ADR-005）。
 * Day-1 目標端點：local BGE-M3（Ollama/vLLM/TEI 的 /v1/embeddings），1024 維。
 * 維度驗證：回傳向量維度與設定不符即擲錯——防止混入不同模型的向量
 * （page_embeddings 是 vector(1024) 固定欄位；換模型=四步 migration 流程，見 ADR-005）。
 */
export class OpenAICompatEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;

  constructor(private options: OpenAICompatEmbeddingOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions;
  }

  async embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const input =
      inputType === "query" && this.options.queryPrefix
        ? texts.map((t) => `${this.options.queryPrefix}${t}`)
        : texts;

    const response = await fetch(`${this.options.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input }),
    });
    if (!response.ok) {
      throw new Error(`embedding 端點回應異常：HTTP ${response.status}`);
    }
    const payload = (await response.json()) as EmbeddingsResponse;
    const rows = payload.data ?? [];
    if (rows.length !== texts.length) {
      throw new Error(`embedding 回傳筆數不符：預期 ${texts.length}、實得 ${rows.length}`);
    }

    // 依 index 還原順序（OpenAI 規格 data 可能亂序）
    const ordered = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = ordered.map((row) => row.embedding ?? []);
    for (const vector of vectors) {
      if (vector.length !== this.dimensions) {
        throw new Error(
          `embedding 維度不符：模型 ${this.model} 回傳 ${vector.length} 維，設定為 ${this.dimensions} 維（換模型需走 reindex migration，見 ADR-005）`,
        );
      }
    }

    logger.debug(
      { model: this.model, count: texts.length, inputTokens: payload.usage?.prompt_tokens ?? null },
      "embedding usage",
    );
    return vectors;
  }
}
