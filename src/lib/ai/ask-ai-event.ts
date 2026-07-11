/**
 * 「問 AI」開啟抽屜的解耦事件（I-05 → I-03 接縫）。
 *
 * Cmd+K 的「✦ 問 AI」列於 isLlmConfigured 時 dispatch 此 window 事件並帶入問題；
 * AI 問答抽屜（I-03，#79）在掛載後 addEventListener 監聽、開抽屜並預帶問題。
 * 以事件解耦，避免 Cmd+K 直接依賴抽屜實作（抽屜可能掛在不同頁面層級）。
 *
 * 純常數與型別，client 安全（不引入 server-only 依賴）。
 */

export const ASK_AI_EVENT = "jetbook:ask-ai" as const;

export interface AskAiEventDetail {
  /** 使用者在 Cmd+K 輸入的問題（原樣帶入抽屜輸入框）。 */
  question: string;
}

/** 型別安全的事件建構子。 */
export function createAskAiEvent(question: string): CustomEvent<AskAiEventDetail> {
  return new CustomEvent(ASK_AI_EVENT, { detail: { question } });
}
