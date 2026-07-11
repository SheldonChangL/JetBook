import "server-only";
import type { ChatUsage, LLMProvider } from "@/lib/llm";
import type { AssistMode } from "./assist-modes";

/**
 * 編輯器寫作輔助的 prompt 組裝與串流編排（I-08，F-AI-08）。
 *
 * 本模組只做「prompt 組裝 + 串流編排」，不碰傳輸層（SSE 編碼在 route handler）、
 * 不碰 DB／權限（權限由呼叫端經 authz 唯一入口把關）。
 *
 * 設計要點：
 * - 一律用 light tier（輕量任務，控制延遲與成本；tier→實際 model 由 env 決定）。
 * - system prompt 嚴格要求「只輸出處理後文字」，避免 LLM 加前言/引號污染結果；
 *   結果由前端面板呈現，永不直接覆寫原文（F-AI-08），套用與否由使用者決定。
 */

/** 輸出 token 上限（輕量改寫任務，控制延遲）。 */
export const ASSIST_MAX_TOKENS = 1024;

/**
 * 共同前導：只輸出結果本身、不臆造、保留語言（翻譯模式由各自指示覆蓋）。
 */
const ASSIST_SYSTEM_PREAMBLE = `你是 JetBook 內部知識庫的寫作輔助助理。使用者會提供一段文字，你需依指示處理它。請嚴格遵守下列規則：
1. 只輸出處理後的文字本身，不要加入任何說明、前言、標題、引號或額外符號。
2. 只依原文內容處理，不新增原文沒有的資訊，也不臆測。
3. 除非指示要求翻譯，否則輸出語言與原文相同；中文一律使用繁體中文（台灣用語）。`;

/** 各模式的任務指示（接在前導之後組成 system prompt）。 */
const MODE_INSTRUCTION: Record<AssistMode, string> = {
  rewrite: "任務：改寫這段文字，使其更清晰、通順、易讀，同時完整保留原意。",
  concise: "任務：精簡這段文字，刪除冗詞贅句使其更簡潔，同時保留原意與重點。",
  formal: "任務：將這段文字改寫為更正式、專業的語氣，同時保留原意。",
  fix: "任務：修正這段文字的錯字、標點與文法錯誤；除錯誤外不改變用字與語氣。",
  translate_en: "任務：將這段文字翻譯成通順、自然的英文，只輸出英文譯文。",
};

/** 組 system prompt：共同前導 + 該模式任務指示。 */
export function buildAssistSystemPrompt(mode: AssistMode): string {
  return `${ASSIST_SYSTEM_PREAMBLE}\n\n${MODE_INSTRUCTION[mode]}`;
}

/** SSE 事件序（route handler 逐一編碼為 event/data 幀）。 */
export type AssistSseEvent =
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: { usage: ChatUsage } };

export interface StreamAssistOptions {
  mode: AssistMode;
  /** 使用者選取的原文（route 已驗長度與非空）。 */
  text: string;
  /** LLM provider（呼叫端須先確認 isLlmConfigured）。 */
  provider: LLMProvider;
  /** client 斷線信號（貫通至 LLM 串流以停止生成）。 */
  signal?: AbortSignal;
  maxTokens?: number;
}

/**
 * 編排 SSE 事件序：(delta)* → done(usage)。逐 token 串流，generator 結束時
 * return 值即本次用量（供 done 事件與用量記錄）。
 */
export async function* streamAssist(
  opts: StreamAssistOptions,
): AsyncGenerator<AssistSseEvent> {
  const stream = opts.provider.chatStream({
    system: buildAssistSystemPrompt(opts.mode),
    messages: [{ role: "user", content: opts.text.trim() }],
    maxTokens: opts.maxTokens ?? ASSIST_MAX_TOKENS,
    tier: "light",
    signal: opts.signal,
  });

  let usage: ChatUsage = { inputTokens: 0, outputTokens: 0 };
  for (;;) {
    const step = await stream.next();
    if (step.done) {
      usage = step.value;
      break;
    }
    yield { event: "delta", data: { text: step.value.text } };
  }
  yield { event: "done", data: { usage } };
}
