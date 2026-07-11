/**
 * LLM／Embedding Provider 抽象層（H-02/H-04，ADR-009、NFR-COMP-01）。
 * - 呼叫端只依賴這組介面；實作以 env `LLM_PROVIDER`/`EMBEDDING_PROVIDER` 切換，換供應商不改碼。
 * - 刻意不暴露 sampling 參數（temperature/top_p…）：claude-sonnet-5 拒絕非預設值，
 *   跨 provider 介面也更乾淨；輸出風格靠 prompt 控制（ADR-009）。
 * - 模型以 tier 抽象（primary＝主力生成、light＝輕量任務），實際 model id 由 env 決定。
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatParams {
  system?: string;
  messages: ChatMessage[];
  maxTokens: number;
  tier: "primary" | "light";
  signal?: AbortSignal;
}

export interface ChatDelta {
  type: "text";
  text: string;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * 串流結束時的彙總結果：本次用量 + 實際使用的 model id。
 * model 供用量記錄（I-06 `ai.query` 稽核）分項統計，與 ChatResult.model 同義。
 */
export interface ChatStreamResult {
  usage: ChatUsage;
  model: string;
}

export interface ChatResult {
  text: string;
  usage: ChatUsage;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  /**
   * 串流輸出（SSE 直通）；逐 token yield 文字增量，generator 結束時
   * `return` 本次用量與 model（供 done 事件與用量記錄）。
   */
  chatStream(params: ChatParams): AsyncGenerator<ChatDelta, ChatStreamResult>;
  /** 非串流（輕量任務）。 */
  chat(params: ChatParams): Promise<ChatResult>;
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  /**
   * @param inputType 檢索文件（document）或查詢（query）——部分模型（BGE-M3 系）
   *                  對 query 需加 instruction 前綴，由實作內部處理。
   */
  embed(texts: string[], inputType: "document" | "query"): Promise<number[][]>;
}
