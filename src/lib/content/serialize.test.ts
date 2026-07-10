import { describe, expect, it } from "vitest";
import { docToMarkdown, docToPlainText } from "./serialize";
import type { ProseMirrorDoc } from "./types";

const doc: ProseMirrorDoc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "安裝指南" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "請先" },
        { type: "text", text: "預熱", marks: [{ type: "bold" }] },
        { type: "text", text: "30 分鐘。" },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "檢查濕度" }] }],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "bash" },
      content: [{ type: "text", text: "echo hi" }],
    },
  ],
};

describe("docToMarkdown", () => {
  it("heading 依 level 產生 # 前綴", () => {
    expect(docToMarkdown(doc)).toContain("# 安裝指南");
  });
  it("行內粗體標記", () => {
    expect(docToMarkdown(doc)).toContain("**預熱**");
  });
  it("清單與程式碼區塊", () => {
    const md = docToMarkdown(doc);
    expect(md).toContain("- 檢查濕度");
    expect(md).toContain("```bash\necho hi\n```");
  });
});

describe("docToPlainText", () => {
  it("抽出全部文字供全文索引（去除 markdown 標記）", () => {
    const text = docToPlainText(doc);
    expect(text).toContain("安裝指南");
    expect(text).toContain("預熱");
    expect(text).toContain("檢查濕度");
    expect(text).not.toContain("**");
    expect(text).not.toContain("#");
  });
});
