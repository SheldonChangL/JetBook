import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAICompatProvider } from "./openai-compat";

/**
 * 以本機 mock OpenAI-compatible SSE server 做真 HTTP 串流整合測試
 * （模擬 vLLM/Ollama 行為：分塊 SSE、最後 chunk 帶 usage、[DONE] 結尾）。
 */

let server: Server;
let baseUrl: string;
let lastRequestBody: Record<string, unknown> | null = null;

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      lastRequestBody = JSON.parse(body) as Record<string, unknown>;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sse({ model: "qwen3-32b", choices: [{ delta: { content: "預熱" } }] }));
      res.write(sse({ choices: [{ delta: { content: "30" } }] }));
      res.write(sse({ choices: [{ delta: { content: " 分鐘" } }] }));
      res.write(
        sse({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 5 } }),
      );
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "object" && address) {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(() => {
  server.close();
});

function makeProvider() {
  return new OpenAICompatProvider({
    baseUrl,
    modelPrimary: "qwen3-32b",
    modelLight: "qwen3-8b",
  });
}

describe("OpenAICompatProvider（mock SSE server 整合）", () => {
  it("chatStream 解析 SSE 逐塊 yield", async () => {
    const out: string[] = [];
    for await (const delta of makeProvider().chatStream({
      messages: [{ role: "user", content: "預熱多久？" }],
      maxTokens: 64,
      tier: "primary",
    })) {
      out.push(delta.text);
    }
    expect(out).toEqual(["預熱", "30", " 分鐘"]);
  });

  it("chat 聚合全文並取得最後 chunk 的 usage", async () => {
    const result = await makeProvider().chat({
      system: "以繁體中文回答",
      messages: [{ role: "user", content: "預熱多久？" }],
      maxTokens: 64,
      tier: "light",
    });
    expect(result.text).toBe("預熱30 分鐘");
    expect(result.usage).toEqual({ inputTokens: 9, outputTokens: 5 });
    expect(result.model).toBe("qwen3-32b");
    // 請求體：light tier 用輕量模型、system 轉為 system message、stream:true
    expect(lastRequestBody?.model).toBe("qwen3-8b");
    expect(lastRequestBody?.stream).toBe(true);
    expect((lastRequestBody?.messages as { role: string }[])[0]?.role).toBe("system");
  });

  it("HTTP 錯誤擲出明確例外", async () => {
    const bad = new OpenAICompatProvider({
      baseUrl: "http://127.0.0.1:1",
      modelPrimary: "x",
      modelLight: "x",
    });
    await expect(
      bad.chat({ messages: [{ role: "user", content: "hi" }], maxTokens: 8, tier: "primary" }),
    ).rejects.toThrow();
  });
});
