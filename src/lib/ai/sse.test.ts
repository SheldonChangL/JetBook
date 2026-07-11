import { describe, expect, it } from "vitest";
import { parseSseStream } from "./sse";
import type { AiStreamEvent } from "./types";

const encoder = new TextEncoder();

/** 以指定的位元組塊構造 ReadableStream（模擬 TCP 任意切分）。 */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<AiStreamEvent[]> {
  const out: AiStreamEvent[] = [];
  for await (const evt of parseSseStream(stream)) out.push(evt);
  return out;
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("parseSseStream", () => {
  it("解析 sources → delta* → done 完整序列", async () => {
    const sources = [
      { n: 1, pageId: "p1", title: "指南", headingPath: "章節", snippet: "摘要", url: "/s/a/b" },
    ];
    const events = await collect(
      streamOf([
        frame("sources", sources),
        frame("delta", { text: "預熱" }),
        frame("delta", { text: "15 分鐘" }),
        frame("done", { usage: { inputTokens: 10, outputTokens: 5 } }),
      ]),
    );
    expect(events).toEqual([
      { event: "sources", data: sources },
      { event: "delta", data: { text: "預熱" } },
      { event: "delta", data: { text: "15 分鐘" } },
      { event: "done", data: { usage: { inputTokens: 10, outputTokens: 5 } } },
    ]);
  });

  it("幀被切在位元組邊界時仍正確重組", async () => {
    const full =
      frame("sources", []) + frame("delta", { text: "hi" }) + frame("done", { usage: { inputTokens: 0, outputTokens: 0 } });
    // 每 3 個字元切一塊，包含把 \n\n 拆開的情形
    const chunks: string[] = [];
    for (let i = 0; i < full.length; i += 3) chunks.push(full.slice(i, i + 3));
    const events = await collect(streamOf(chunks));
    expect(events.map((e) => e.event)).toEqual(["sources", "delta", "done"]);
  });

  it("多字節中文被切開時以 stream 解碼不亂碼", async () => {
    const payload = frame("delta", { text: "雷射模組" });
    const bytes = encoder.encode(payload);
    // 在中間位元組硬切成兩塊（大機率落在多字節 UTF-8 字元中間）
    const mid = Math.floor(bytes.length / 2);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, mid));
        controller.enqueue(bytes.slice(mid));
        controller.close();
      },
    });
    const events = await collect(stream);
    expect(events).toEqual([{ event: "delta", data: { text: "雷射模組" } }]);
  });

  it("解析 error 事件", async () => {
    const events = await collect(streamOf([frame("error", { message: "產生失敗" })]));
    expect(events).toEqual([{ event: "error", data: { message: "產生失敗" } }]);
  });

  it("略過未知 event 與壞 JSON，不中斷後續事件", async () => {
    const events = await collect(
      streamOf([
        "event: heartbeat\ndata: {}\n\n", // 未知 event
        "event: delta\ndata: {壞掉的 json}\n\n", // data 無法解析
        frame("delta", { text: "ok" }),
      ]),
    );
    expect(events).toEqual([{ event: "delta", data: { text: "ok" } }]);
  });

  it("處理 SSE 註解行與缺空白的 data", async () => {
    const events = await collect(
      streamOf([": keep-alive comment\n", `event:delta\ndata:${JSON.stringify({ text: "x" })}\n\n`]),
    );
    expect(events).toEqual([{ event: "delta", data: { text: "x" } }]);
  });
});
