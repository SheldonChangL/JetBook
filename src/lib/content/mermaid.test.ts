import { describe, expect, it } from "vitest";
import {
  DEFAULT_MERMAID_SOURCE,
  MERMAID_NODE_NAME,
  normalizeMermaidSource,
} from "./mermaid";

describe("normalizeMermaidSource", () => {
  it("字串原樣回傳", () => {
    expect(normalizeMermaidSource("graph TD; A-->B")).toBe("graph TD; A-->B");
    expect(normalizeMermaidSource("")).toBe("");
  });

  it("非字串（null/undefined/物件/數字）回落空字串，確保渲染與序列化不炸", () => {
    expect(normalizeMermaidSource(null)).toBe("");
    expect(normalizeMermaidSource(undefined)).toBe("");
    expect(normalizeMermaidSource(123)).toBe("");
    expect(normalizeMermaidSource({})).toBe("");
  });
});

describe("Mermaid 常數", () => {
  it("節點名稱固定為 mermaid", () => {
    expect(MERMAID_NODE_NAME).toBe("mermaid");
  });

  it("預設範例為可渲染的 mermaid 語法", () => {
    expect(DEFAULT_MERMAID_SOURCE.startsWith("graph")).toBe(true);
    expect(normalizeMermaidSource(DEFAULT_MERMAID_SOURCE)).toBe(DEFAULT_MERMAID_SOURCE);
  });
});
