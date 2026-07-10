import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAICompatEmbeddingProvider } from "./embedding";

/** mock /v1/embeddings server：驗證批次、順序還原、維度檢查、query 前綴。 */

let server: Server;
let baseUrl: string;
let lastBody: { model?: string; input?: string[] } | null = null;
let responseDimensions = 4;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastBody = JSON.parse(body) as typeof lastBody;
      const input = lastBody?.input ?? [];
      // 刻意亂序回傳，驗證 index 排序還原
      const data = input
        .map((_, i) => ({ index: i, embedding: Array(responseDimensions).fill(i + 0.5) }))
        .reverse();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data, usage: { prompt_tokens: 7 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "object" && address) baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => server.close());

function makeProvider(dimensions = 4, queryPrefix?: string) {
  return new OpenAICompatEmbeddingProvider({
    baseUrl,
    model: "bge-m3",
    dimensions,
    queryPrefix,
  });
}

describe("OpenAICompatEmbeddingProvider", () => {
  it("批次嵌入並依 index 還原順序", async () => {
    responseDimensions = 4;
    const vectors = await makeProvider().embed(["甲", "乙", "丙"], "document");
    expect(vectors).toHaveLength(3);
    expect(vectors[0]?.[0]).toBe(0.5);
    expect(vectors[2]?.[0]).toBe(2.5);
  });

  it("維度不符擲出明確錯誤（ADR-005 防混向量）", async () => {
    responseDimensions = 8;
    await expect(makeProvider(4).embed(["甲"], "document")).rejects.toThrow(/維度不符/);
    responseDimensions = 4;
  });

  it("query 前綴僅套用於 query inputType", async () => {
    const provider = makeProvider(4, "為這個句子生成表示：");
    await provider.embed(["雷射校準"], "query");
    expect(lastBody?.input?.[0]).toBe("為這個句子生成表示：雷射校準");
    await provider.embed(["雷射校準"], "document");
    expect(lastBody?.input?.[0]).toBe("雷射校準");
  });

  it("空輸入回空陣列（不打端點）", async () => {
    expect(await makeProvider().embed([], "document")).toEqual([]);
  });
});
