import { describe, expect, it } from "vitest";
import { splitCitations } from "./citations";

describe("splitCitations", () => {
  it("純文字無標註時回單一 text 片段", () => {
    expect(splitCitations("沒有引用的一段話")).toEqual([
      { type: "text", value: "沒有引用的一段話" },
    ]);
  });

  it("切出單一 [n] 引用並保留前後文字", () => {
    expect(splitCitations("預熱 15 分鐘[1]。")).toEqual([
      { type: "text", value: "預熱 15 分鐘" },
      { type: "cite", n: 1 },
      { type: "text", value: "。" },
    ]);
  });

  it("相鄰多個引用各自成片段", () => {
    expect(splitCitations("穩定後校準[1][2]")).toEqual([
      { type: "text", value: "穩定後校準" },
      { type: "cite", n: 1 },
      { type: "cite", n: 2 },
    ]);
  });

  it("支援多位數編號", () => {
    expect(splitCitations("見[12]")).toEqual([
      { type: "text", value: "見" },
      { type: "cite", n: 12 },
    ]);
  });

  it("非數字方括號原樣保留為文字", () => {
    expect(splitCitations("[備註] 與 [TODO]")).toEqual([
      { type: "text", value: "[備註] 與 [TODO]" },
    ]);
  });

  it("空字串回空陣列", () => {
    expect(splitCitations("")).toEqual([]);
  });

  it("開頭即引用不產生空 text 片段", () => {
    expect(splitCitations("[1]開頭")).toEqual([
      { type: "cite", n: 1 },
      { type: "text", value: "開頭" },
    ]);
  });
});
