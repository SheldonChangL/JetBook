import type { AiStreamEvent } from "./types";

/**
 * 解析 `/api/ai/chat` 的 SSE 回應串（I-03）。
 *
 * 純函式、無 DOM/server 相依：吃 `ReadableStream<Uint8Array>`（fetch 回應 body），
 * 逐幀（`event:`/`data:` 以空行分隔）解碼並產出型別化事件。
 *
 * 容錯設計：
 * - 幀可能被 TCP 切在任意位元組邊界 → 以 TextDecoder(stream) 累積緩衝，僅在遇到
 *   完整的 `\n\n` 分隔時才切幀，殘餘留待下一塊。
 * - 未知 event 名稱或無法 JSON 解析的 data 一律略過（不讓單一壞幀中斷整串）。
 * - 呼叫端以 AbortController 中止 fetch 時，reader 讀取會拋出，交由呼叫端處理
 *   （視為「停止生成」而非錯誤）。
 */

const KNOWN_EVENTS = new Set(["sources", "delta", "done", "error"]);

/** 解析單一 SSE 幀（多行 `field: value`）為型別化事件；無法解析回 null。 */
function parseFrame(frame: string): AiStreamEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of frame.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "" || line.startsWith(":")) continue; // 空行／註解
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // SSE 規範：冒號後首個空白略去
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }

  if (!event || !KNOWN_EVENTS.has(event) || dataLines.length === 0) return null;

  let data: unknown;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }

  // 已知 event 名稱 + 已解析 data：交由消費端依 event 判斷 data 形狀。
  return { event, data } as AiStreamEvent;
}

/**
 * 逐幀產出 SSE 事件。以 `\n\n` 為幀邊界；緩衝殘餘處理跨塊切分。
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<AiStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      // 一次可能收到多幀；逐一切出已完成幀。
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const evt = parseFrame(frame);
        if (evt) yield evt;
      }
    }
    // 串流結束時 flush 殘餘（正常情況下 route 每幀都以 \n\n 結尾，殘餘為空）。
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      const evt = parseFrame(tail);
      if (evt) yield evt;
    }
  } finally {
    reader.releaseLock();
  }
}
