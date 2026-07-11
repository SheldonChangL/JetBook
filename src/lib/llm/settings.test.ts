import { describe, expect, it } from "vitest";
import {
  getAiSettingsSummary,
  maskApiKeyLast4,
  testEmbeddingConnection,
  testLlmConnection,
} from "./settings";
import type { ChatDelta, ChatResult, EmbeddingProvider, LLMProvider } from "./provider";

/**
 * L-03 AI 連線設定摘要與連線測試單元測試。
 * 連線測試以注入的假 provider 驗成功／失敗兩路（不依賴真端點；env 未設定亦可測）。
 */

const okLlm: LLMProvider = {
  name: "fake",
  async *chatStream(): AsyncGenerator<ChatDelta, { inputTokens: number; outputTokens: number }> {
    yield { type: "text", text: "pong" };
    return { inputTokens: 1, outputTokens: 1 };
  },
  async chat(): Promise<ChatResult> {
    return { text: "pong", model: "fake-light", usage: { inputTokens: 1, outputTokens: 1 } };
  },
};

const throwingLlm: LLMProvider = {
  name: "fake",
  async *chatStream(): AsyncGenerator<ChatDelta, { inputTokens: number; outputTokens: number }> {
    yield { type: "text", text: "" };
    return { inputTokens: 0, outputTokens: 0 };
  },
  async chat(): Promise<ChatResult> {
    throw new Error("HTTP 401 unauthorized");
  },
};

const okEmbedding: EmbeddingProvider = {
  model: "bge-m3",
  dimensions: 1024,
  async embed(texts) {
    return texts.map(() => new Array(1024).fill(0));
  },
};

const throwingEmbedding: EmbeddingProvider = {
  model: "bge-m3",
  dimensions: 1024,
  async embed() {
    throw new Error("embedding 端點回應異常：HTTP 500");
  },
};

describe("maskApiKeyLast4", () => {
  it("未設定回 null", () => {
    expect(maskApiKeyLast4(undefined)).toBeNull();
    expect(maskApiKeyLast4(null)).toBeNull();
    expect(maskApiKeyLast4("")).toBeNull();
  });

  it("長度 < 8 全遮（不洩短 key）", () => {
    expect(maskApiKeyLast4("short")).toBe("••••••••");
  });

  it("長 key 只保留末四碼", () => {
    expect(maskApiKeyLast4("sk-ant-api03-ABCDEFGH1234")).toBe("••••1234");
  });
});

describe("getAiSettingsSummary（單元 env 未設定 AI）", () => {
  it("provider 未設定時回未設定狀態，embedding 帶預設 model／維度", () => {
    const summary = getAiSettingsSummary();
    expect(summary.llm.configured).toBe(false);
    expect(summary.llm.provider).toBeNull();
    expect(summary.llm.apiKeyLast4).toBeNull();
    expect(summary.embedding.configured).toBe(false);
    expect(summary.embedding.model).toBe("bge-m3");
    expect(summary.embedding.dimensions).toBe(1024);
  });
});

describe("testLlmConnection", () => {
  it("provider 成功回 ok", async () => {
    expect(await testLlmConnection(okLlm)).toEqual({ status: "ok" });
  });

  it("provider 擲錯回 error＋原因", async () => {
    const result = await testLlmConnection(throwingLlm);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toContain("401");
  });
});

describe("testEmbeddingConnection", () => {
  it("provider 成功回 ok", async () => {
    expect(await testEmbeddingConnection(okEmbedding)).toEqual({ status: "ok" });
  });

  it("provider 擲錯回 error＋原因", async () => {
    const result = await testEmbeddingConnection(throwingEmbedding);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toContain("HTTP 500");
  });
});
