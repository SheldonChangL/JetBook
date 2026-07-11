import "server-only";
import type { Actor } from "@/lib/authz/permission";
import type { ChatUsage, LLMProvider } from "@/lib/llm";
import { slugifyHeadingText } from "@/lib/content/heading-slug";
import { HEADING_PATH_SEPARATOR } from "./chunker";
import type { RetrievedChunk } from "./retriever";

/**
 * RAG 回答組裝與串流編排（I-02，F-AI-04）。
 *
 * 本模組只做「純資料轉換 + 串流編排」，不碰傳輸層（SSE 編碼在 route handler）：
 * - buildSources：檢索結果 → 帶編號的引用來源（n 對應 prompt 的 [1][2]）。
 * - buildUserPrompt：帶編號的 chunk 內容 + 問題，與 buildSources 用同一順序，
 *   確保 LLM 標註的 [n] 能對回 sources[n-1]。
 * - streamChatAnswer：retrieve → 送 sources → 無結果送固定訊息且**不呼叫 LLM**
 *   → 有結果組 prompt 逐 token 串流 → 送 done(usage)。
 *
 * 安全鐵律：檢索一律經注入的 retrieveFn（預設 retriever.retrieve，權限於 SQL 層
 * join 過濾，N-04）；本模組不自行接觸資料庫或權限邏輯。
 */

/** 引用來源（送給前端渲染來源卡片與 F-AI-05 引用跳轉）。 */
export interface AnswerSource {
  /** 1-based 編號，對應回答中的 [n] 標註與 prompt 內的資料編號。 */
  n: number;
  pageId: string;
  title: string;
  headingPath: string;
  snippet: string;
  /**
   * 站內相對連結（`/s/<spaceSlug>/<pageSlug>`）；chunk 有 heading 時附錨點
   * （`#<slug>`，slug 與 G-05 閱讀頁標題 id 同規則，供 I-04 引用跳轉直接定位）。
   * 無對應 heading（headingPath 為空）則不帶錨點，載入時退化為頁面頂部。
   */
  url: string;
}

/** SSE 事件序（route handler 逐一編碼為 event/data 幀）。 */
export type SseEvent =
  | { event: "sources"; data: AnswerSource[] }
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: { usage: ChatUsage } };

/** 回答生成 token 上限（控制延遲與成本；輸出風格靠 prompt 控制，ADR-009）。 */
export const ANSWER_MAX_TOKENS = 1024;

/** 來源卡片摘要長度上限（字元）。 */
const SNIPPET_MAX_LENGTH = 160;

/**
 * System prompt：只依提供資料回答、不足即明說、繁體中文、以 [n] 標註引用
 * （F-AI-04 驗收 1；避免虛構）。
 */
export const SYSTEM_PROMPT = `你是 JetBook 內部知識庫的問答助理。請嚴格遵守下列規則：
1. 只能依據下方「參考資料」中的內容回答，禁止使用參考資料以外的知識或臆測。
2. 若參考資料不足以回答問題，直接說明「知識庫中找不到相關資訊」，絕不編造內容。
3. 一律使用繁體中文（台灣用語）回答。
4. 引用資料時，在對應句子的句末以 [1]、[2] 等編號標註來源，編號對應參考資料的編號。`;

function toSnippet(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= SNIPPET_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, SNIPPET_MAX_LENGTH)}…`;
}

/**
 * 由 headingPath 取最深層 heading 的錨點 slug（I-04）。
 * headingPath 以 `HEADING_PATH_SEPARATOR` 串接階層標題，取末段（最深）並以
 * 與閱讀頁（G-05）相同的 `slugifyHeadingText` 轉為 id；無 heading 或 slug 為空回 null。
 */
export function headingAnchor(headingPath: string): string | null {
  const deepest = headingPath
    .split(HEADING_PATH_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  if (!deepest) return null;
  const slug = slugifyHeadingText(deepest);
  return slug || null;
}

/** 組來源站內連結；有 heading 時附錨點（`#<encodeURIComponent(slug)>`，與 G-05 分享連結同規則）。 */
function sourceUrl(spaceSlug: string, pageSlug: string, headingPath: string): string {
  const base = `/s/${spaceSlug}/${pageSlug}`;
  const anchor = headingAnchor(headingPath);
  return anchor ? `${base}#${encodeURIComponent(anchor)}` : base;
}

/** 檢索結果 → 帶編號引用來源（順序即編號來源，與 prompt 一致）。 */
export function buildSources(chunks: RetrievedChunk[]): AnswerSource[] {
  return chunks.map((c, i) => ({
    n: i + 1,
    pageId: c.pageId,
    title: c.title,
    headingPath: c.headingPath,
    snippet: toSnippet(c.chunkText),
    url: sourceUrl(c.spaceSlug, c.pageSlug, c.headingPath),
  }));
}

/** 組 user prompt：帶編號的 chunk（標題／章節 + 內容）+ 問題。 */
export function buildUserPrompt(chunks: RetrievedChunk[], question: string): string {
  const blocks = chunks
    .map((c, i) => {
      const heading = c.headingPath ? `${c.title} ／ ${c.headingPath}` : c.title;
      return `[${i + 1}] 來源：${heading}\n${c.chunkText.trim()}`;
    })
    .join("\n\n");
  return `參考資料：\n\n${blocks}\n\n問題：${question.trim()}\n\n請依據上述參考資料以繁體中文回答，並在引用處以對應編號 [1][2] 標註來源。`;
}

/** 檢索函式介面（預設 retriever.retrieve；測試可注入 fake）。 */
export type RetrieveFn = (
  actor: Actor,
  query: string,
  options: { spaceId?: string },
) => Promise<RetrievedChunk[]>;

export interface StreamChatAnswerOptions {
  actor: Actor;
  question: string;
  spaceId?: string;
  /** 無檢索結果時回覆的固定訊息（由呼叫端經 i18n 提供）。 */
  noResultsMessage: string;
  /** client 斷線信號（貫通至 LLM 串流以停止生成）。 */
  signal?: AbortSignal;
  /** 檢索函式（權限於 SQL 層過濾）。 */
  retrieveFn: RetrieveFn;
  /** LLM provider（呼叫端須先確認 isLlmConfigured）。 */
  provider: LLMProvider;
  maxTokens?: number;
}

/**
 * 編排 SSE 事件序：sources → (delta)* → done(usage)。
 * 無檢索結果：送 sources:[] + 固定訊息 delta + done，**不呼叫 LLM**。
 */
export async function* streamChatAnswer(
  opts: StreamChatAnswerOptions,
): AsyncGenerator<SseEvent> {
  const chunks = await opts.retrieveFn(opts.actor, opts.question, {
    spaceId: opts.spaceId,
  });
  const sources = buildSources(chunks);
  yield { event: "sources", data: sources };

  // 無依據：回覆固定訊息，絕不呼叫 LLM（F-AI-04 驗收 1；避免虛構）。
  if (sources.length === 0) {
    yield { event: "delta", data: { text: opts.noResultsMessage } };
    yield { event: "done", data: { usage: { inputTokens: 0, outputTokens: 0 } } };
    return;
  }

  const stream = opts.provider.chatStream({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(chunks, opts.question) }],
    maxTokens: opts.maxTokens ?? ANSWER_MAX_TOKENS,
    tier: "primary",
    signal: opts.signal,
  });

  // 逐 token 串流；generator 結束時 return 值即本次 usage。
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
