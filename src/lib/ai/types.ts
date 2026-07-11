/**
 * AI 問答的前後端「線協定」型別（I-03）。
 *
 * 這裡刻意不從 `src/lib/rag/answer.ts` 匯入 `AnswerSource`/`SseEvent`，因為那是
 * `server-only` 模組，client bundle 不得引入。此檔為純型別（無執行期相依），
 * 內容須與 route handler 送出的 SSE 幀（answer.ts 的 `SseEvent`）保持一致。
 */

/** 引用來源（對應 answer.ts 的 AnswerSource；n 對回答內文的 [n] 標註）。 */
export interface AiSource {
  /** 1-based 編號，對應回答中的 [n] 標註。 */
  n: number;
  pageId: string;
  title: string;
  headingPath: string;
  snippet: string;
  /** 站內相對連結（/s/<spaceSlug>/<pageSlug>）。 */
  url: string;
}

/** 本次問答的 token 用量（對應 answer.ts 的 ChatUsage）。 */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

/** SSE 事件（route handler 逐幀送出；error 由 route 在失敗時補送）。 */
export type AiStreamEvent =
  | { event: "sources"; data: AiSource[] }
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: { usage: AiUsage } }
  | { event: "error"; data: { message: string } };
