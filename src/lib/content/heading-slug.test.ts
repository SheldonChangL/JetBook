import { describe, expect, it } from "vitest";
import { createHeadingSlugger, headingNodeText, slugifyHeadingText } from "./heading-slug";
import type { ProseMirrorNode } from "./types";

describe("slugifyHeadingText", () => {
  it("英文轉小寫、空白轉連字號", () => {
    expect(slugifyHeadingText("Getting Started Guide")).toBe("getting-started-guide");
  });

  it("保留中日韓文字", () => {
    expect(slugifyHeadingText("安裝指南")).toBe("安裝指南");
    expect(slugifyHeadingText("安裝 指南 v2")).toBe("安裝-指南-v2");
  });

  it("去除符號、收斂連續連字號、去頭尾連字號", () => {
    expect(slugifyHeadingText("  Hello, World!  ")).toBe("hello-world");
    expect(slugifyHeadingText("A —— B")).toBe("a-b");
    expect(slugifyHeadingText("!!!")).toBe("");
  });
});

describe("headingNodeText", () => {
  it("遞迴串接標題內所有 text（忽略 marks）", () => {
    const node: ProseMirrorNode = {
      type: "heading",
      attrs: { level: 2 },
      content: [
        { type: "text", text: "步驟 " },
        { type: "text", text: "一", marks: [{ type: "bold" }] },
      ],
    };
    expect(headingNodeText(node)).toBe("步驟 一");
  });
});

describe("createHeadingSlugger", () => {
  it("同名標題以遞增後綴去重", () => {
    const slug = createHeadingSlugger();
    expect(slug("摘要")).toBe("摘要");
    expect(slug("摘要")).toBe("摘要-1");
    expect(slug("摘要")).toBe("摘要-2");
  });

  it("生成的 id 也納入避免二次碰撞", () => {
    const slug = createHeadingSlugger();
    expect(slug("摘要")).toBe("摘要");
    expect(slug("摘要 1")).toBe("摘要-1");
    // 此時再出現「摘要」，-1 已被占用，跳到 -2
    expect(slug("摘要")).toBe("摘要-2");
  });

  it("空 slug 回退到 fallback 並各自去重", () => {
    const slug = createHeadingSlugger();
    expect(slug("!!!")).toBe("section");
    expect(slug("###")).toBe("section-1");
  });
});
