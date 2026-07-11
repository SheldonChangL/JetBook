/**
 * 拆解 AI 回答內文的 `[n]` 引用標註（I-03，F-AI-05）。
 *
 * 純字串處理：把一段文字切成「純文字」與「引用編號」交錯的片段，供渲染層把
 * `[n]` 換成可點擊的上標 chip。只認 1–3 位數字（來源數不會超過個位/十位），
 * 其他方括號內容（如 `[備註]`、`[TODO]`）原樣保留為文字。
 */

export type AnswerSegment =
  | { type: "text"; value: string }
  | { type: "cite"; n: number };

const CITE_RE = /\[(\d{1,3})\]/g;

/** 把含 `[n]` 標註的文字切成文字/引用片段序列。 */
export function splitCitations(text: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CITE_RE.lastIndex = 0;
  while ((match = CITE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "cite", n: Number(match[1]) });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments;
}
