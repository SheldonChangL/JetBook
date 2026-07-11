import "server-only";
import type { Actor } from "@/lib/authz/permission";
import type { ChatMessage, ChatUsage, LLMProvider } from "@/lib/llm";
import {
  streamChatAnswer,
  type AnswerSource,
  type RetrieveFn,
  type SseEvent,
} from "@/lib/rag/answer";
import {
  appendMessage,
  createConversation,
  loadHistory,
  touchConversation,
  updateConversationTitle,
  type HistoryMessage,
} from "./conversations";

/**
 * 多輪對話編排（I-07，F-AI-07）。薄殼 route handler 呼叫本模組，本模組負責：
 * 1. 新對話則建立（暫定標題＝截斷首問）並送出 `conversation` 事件（讓 client 記住 id 續談）。
 * 2. 續談：載入歷史，以 light tier query rewrite 把追問改寫為不依賴脈絡的獨立查詢再檢索。
 * 3. 串流回答（history 帶脈絡、retrievalQuery 帶當前意圖），完成後把 user／assistant 訊息
 *    連同來源快照寫入 ai_messages（中斷／失敗則不落庫，避免半截或懸空的 user 訊息）。
 * 4. 新對話於回答完成後以 light tier 生成標題並回填。
 *
 * 安全：對話為使用者私有資源，續談前的擁有者驗證由呼叫端（route）以 getConversation 完成；
 * 檢索權限一律於 SQL 層過濾（retrieveFn，N-04），本模組不接觸權限判斷。
 */

/** 餵給 LLM 的最近對話輪數上限（每輪＝一 user＋一 assistant）。 */
export const MAX_HISTORY_TURNS = 8;
/** query rewrite 參考的最近訊息數（控制改寫 prompt 大小）。 */
const REWRITE_CONTEXT_MESSAGES = 6;
/** query rewrite 輸出 token 上限（輕量任務）。 */
const REWRITE_MAX_TOKENS = 256;
/** 標題生成輸出 token 上限。 */
const TITLE_MAX_TOKENS = 64;
/** 標題／暫定標題字元上限。 */
const TITLE_MAX_CHARS = 40;

/** query rewrite system prompt：把帶脈絡的追問改寫為可獨立檢索的查詢。 */
export const QUERY_REWRITE_SYSTEM = `你是檢索查詢改寫器。使用者正在與知識庫助理多輪對話，最新一則可能是依賴前文的追問（如「那另一個呢」「它的限制是什麼」）。請根據對話脈絡，把最新追問改寫為一個語意完整、不依賴前文即可獨立檢索的查詢。規則：
1. 只輸出改寫後的查詢字串本身，不要加任何說明、標點修飾、引號或前言。
2. 保留原語言；中文一律使用繁體中文。
3. 若最新提問本身已可獨立檢索，原樣輸出即可。`;

/** 標題生成 system prompt：由首問產生精簡標題。 */
export const TITLE_SYSTEM = `請為使用者的問題產生一個精簡的對話標題。規則：
1. 只輸出標題本身，不要加引號、標點結尾、前言或說明。
2. 長度不超過 15 個字，濃縮問題主題。
3. 使用與問題相同的語言；中文一律使用繁體中文（台灣用語）。`;

/** 對話串流事件：新增 `conversation`（帶對話 id），其餘沿用 answer.ts 的 SSE 事件序。 */
export type ConversationSseEvent = { event: "conversation"; data: { id: string } } | SseEvent;

export interface RunConversationChatOptions {
  actor: Actor;
  question: string;
  /** 既有對話 id（續談）；未提供則新建。呼叫端須已驗證擁有者。 */
  conversationId?: string;
  /** 限定檢索的 space（新對話會記錄之，續談沿用呼叫端傳入值）。 */
  spaceId?: string;
  /** 無檢索結果時回覆的固定訊息（呼叫端經 i18n 提供）。 */
  noResultsMessage: string;
  signal?: AbortSignal;
  provider: LLMProvider;
  /** 檢索函式（權限於 SQL 層過濾；預設 retriever.retrieve，測試可注入）。 */
  retrieveFn: RetrieveFn;
  maxTokens?: number;
}

/**
 * runConversationChat 結束時的彙總（供 route 記錄 I-06 用量）。
 * usage／model 為 null 表示未實際呼叫 LLM 生成（無檢索結果）→ 不記 ai.query。
 */
export interface ConversationChatSummary {
  conversationId: string;
  usage: ChatUsage | null;
  model: string | null;
}

/** 由首問截出暫定標題（單行、去頭尾空白、限長）。 */
export function provisionalTitle(question: string): string {
  return truncate(question.replace(/\s+/g, " ").trim(), TITLE_MAX_CHARS);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

/**
 * 把歷史訊息映射為 LLM messages：以「user→assistant」成對取用，只保留雙方皆非空的完整輪次，
 * 再截斷為最近 MAX_HISTORY_TURNS 輪。訊息本就成對落庫（見持久化段），此處額外防禦退化的空回答
 * ——避免空內容或角色不交替違反 provider 對 messages 的要求（Anthropic 要求非空且 user 起首交替）。
 */
function toLlmHistory(history: HistoryMessage[]): ChatMessage[] {
  const pairs: ChatMessage[] = [];
  for (let i = 0; i + 1 < history.length; i += 2) {
    const u = history[i]!;
    const a = history[i + 1]!;
    if (u.role === "user" && a.role === "assistant" && u.content.trim() && a.content.trim()) {
      pairs.push({ role: "user", content: u.content }, { role: "assistant", content: a.content });
    }
  }
  return pairs.slice(-MAX_HISTORY_TURNS * 2);
}

/**
 * 追問 query rewrite（light tier）。以最近數則訊息為脈絡把追問改寫為獨立查詢。
 * 失敗（非中斷）則退回原問題；中斷則向上拋出由呼叫端處理。
 */
export async function rewriteFollowUp(
  provider: LLMProvider,
  history: HistoryMessage[],
  question: string,
  signal?: AbortSignal,
): Promise<string> {
  const recent = history.slice(-REWRITE_CONTEXT_MESSAGES);
  const context = recent
    .map((m) => `${m.role === "user" ? "使用者" : "助理"}：${m.content}`)
    .join("\n");
  const userContent = `對話脈絡：\n${context}\n\n最新追問：${question.trim()}\n\n請輸出改寫後可獨立檢索的查詢：`;
  try {
    const result = await provider.chat({
      system: QUERY_REWRITE_SYSTEM,
      messages: [{ role: "user", content: userContent }],
      maxTokens: REWRITE_MAX_TOKENS,
      tier: "light",
      signal,
    });
    const rewritten = result.text.replace(/\s+/g, " ").trim();
    return rewritten.length > 0 ? rewritten : question;
  } catch (err) {
    if (signal?.aborted) throw err;
    // 改寫失敗不致命：退回以原追問檢索（可能少了脈絡但不中斷問答）。
    return question;
  }
}

/**
 * 由首問生成對話標題（light tier）。失敗回 null（保留暫定標題）；中斷則向上拋出。
 */
export async function generateTitle(
  provider: LLMProvider,
  question: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const result = await provider.chat({
      system: TITLE_SYSTEM,
      messages: [{ role: "user", content: question.trim() }],
      maxTokens: TITLE_MAX_TOKENS,
      tier: "light",
      signal,
    });
    const title = truncate(result.text.replace(/\s+/g, " ").trim(), TITLE_MAX_CHARS);
    return title.length > 0 ? title : null;
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}

/**
 * 編排一次對話回合並串流 SSE 事件序：conversation → sources → (delta)* → done(usage)。
 * 回答完成後持久化 user／assistant 訊息（含來源快照）與更新對話時間；新對話生成標題。
 */
export async function* runConversationChat(
  opts: RunConversationChatOptions,
): AsyncGenerator<ConversationSseEvent, ConversationChatSummary> {
  const isNew = !opts.conversationId;
  let conversationId = opts.conversationId;
  if (!conversationId) {
    const created = await createConversation({
      userId: opts.actor.id,
      spaceId: opts.spaceId ?? null,
      title: provisionalTitle(opts.question),
    });
    conversationId = created.id;
  }
  yield { event: "conversation", data: { id: conversationId } };

  // 續談：載入既有歷史（本模組不重驗擁有者——呼叫端已驗），首問則無歷史。
  const rawHistory = isNew ? [] : await loadHistory(conversationId);
  const llmHistory = toLlmHistory(rawHistory);

  // 追問才需 query rewrite（首問直接以原問題檢索）。
  const retrievalQuery =
    rawHistory.length > 0
      ? await rewriteFollowUp(opts.provider, rawHistory, opts.question, opts.signal)
      : opts.question;

  // 串流回答；沿途累積回答全文與來源快照供落庫。
  let answerText = "";
  let sources: AnswerSource[] = [];
  const gen = streamChatAnswer({
    actor: opts.actor,
    question: opts.question,
    spaceId: opts.spaceId,
    history: llmHistory,
    retrievalQuery,
    noResultsMessage: opts.noResultsMessage,
    signal: opts.signal,
    retrieveFn: opts.retrieveFn,
    provider: opts.provider,
    maxTokens: opts.maxTokens,
  });

  let summary: { usage: ChatUsage; model: string } | null = null;
  for (;;) {
    const step = await gen.next();
    if (step.done) {
      summary = step.value;
      break;
    }
    const evt = step.value;
    if (evt.event === "sources") sources = evt.data;
    else if (evt.event === "delta") answerText += evt.data.text;
    yield evt;
  }

  // 串流正常結束才落庫（中斷／失敗會在上方 for 迴圈拋出，跳過此段；不留半截或懸空訊息）。
  await appendMessage({ conversationId, role: "user", content: opts.question, sources: null });
  await appendMessage({
    conversationId,
    role: "assistant",
    content: answerText,
    sources: sources.length > 0 ? sources : null,
  });
  await touchConversation(conversationId);

  // 新對話：以首問生成標題並回填（失敗保留暫定標題，不中斷）。
  if (isNew) {
    const title = await generateTitle(opts.provider, opts.question, opts.signal);
    if (title) await updateConversationTitle(conversationId, title);
  }

  return {
    conversationId,
    usage: summary?.usage ?? null,
    model: summary?.model ?? null,
  };
}
