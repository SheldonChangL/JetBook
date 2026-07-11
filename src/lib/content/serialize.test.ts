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

describe("docToMarkdown 圖片節點（D-07）", () => {
  it("image 節點序列化為 Markdown 圖片語法（alt + src）", () => {
    const withImage: ProseMirrorDoc = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "/api/files/abc", alt: "爐體外觀" } },
        { type: "image", attrs: { src: "/api/files/def" } },
      ],
    };
    const md = docToMarkdown(withImage);
    expect(md).toContain("![爐體外觀](/api/files/abc)");
    expect(md).toContain("![](/api/files/def)");
  });
});

describe("docToMarkdown 表格節點（D-05）", () => {
  const tableDoc: ProseMirrorDoc = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [{ type: "paragraph", content: [{ type: "text", text: "型號" }] }],
              },
              {
                type: "tableHeader",
                content: [{ type: "paragraph", content: [{ type: "text", text: "溫度" }] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "JB-1" }] }],
              },
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "300°C" }] }],
              },
            ],
          },
        ],
      },
    ],
  };

  it("序列化為 GFM 表格（表頭列 + 分隔列 + 資料列）", () => {
    const md = docToMarkdown(tableDoc);
    const lines = md.split("\n");
    expect(lines[0]).toBe("| 型號 | 溫度 |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(lines[2]).toBe("| JB-1 | 300°C |");
  });

  it("純文字抽取涵蓋所有儲存格內容（供全文索引）", () => {
    const text = docToPlainText(tableDoc);
    for (const cell of ["型號", "溫度", "JB-1", "300°C"]) {
      expect(text).toContain(cell);
    }
    expect(text).not.toContain("|");
    expect(text).not.toContain("---");
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
