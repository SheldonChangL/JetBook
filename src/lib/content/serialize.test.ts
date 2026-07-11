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

describe("docToMarkdown/PlainText mention 與 pageLink（D-11）", () => {
  const doc: ProseMirrorDoc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "請洽 " },
          { type: "mention", attrs: { id: "u1", label: "王小明" } },
          { type: "text", text: "，詳見 " },
          { type: "pageLink", attrs: { id: "p1", label: "安裝指南" } },
          { type: "text", text: "。" },
        ],
      },
    ],
  };

  it("mention 序列化為「@姓名」（Markdown 與純文字皆然，供匯出/全文索引）", () => {
    expect(docToMarkdown(doc)).toContain("@王小明");
    expect(docToPlainText(doc)).toContain("@王小明");
  });

  it("pageLink 以 label 快照序列化（連結文字進索引；現行 slug 於閱讀端解析）", () => {
    expect(docToMarkdown(doc)).toContain("安裝指南");
    expect(docToPlainText(doc)).toContain("安裝指南");
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

describe("docToMarkdown 附件節點（D-08）", () => {
  it("attachment 節點序列化為 Markdown 連結（檔名 + /api/files/<id>）", () => {
    const withAttachment: ProseMirrorDoc = {
      type: "doc",
      content: [
        {
          type: "attachment",
          attrs: { attachmentId: "abc-123", fileName: "規格書.pdf", sizeBytes: 20480 },
        },
      ],
    };
    expect(docToMarkdown(withAttachment)).toContain("[規格書.pdf](/api/files/abc-123)");
  });
});

describe("docToMarkdown callout 節點（D-06）", () => {
  const calloutDoc: ProseMirrorDoc = {
    type: "doc",
    content: [
      {
        type: "callout",
        attrs: { kind: "warning" },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "雷射電源須維持關閉" }] },
        ],
      },
    ],
  };

  it("序列化為 GFM alert（> [!KIND] + 引用行）", () => {
    const md = docToMarkdown(calloutDoc);
    expect(md).toContain("> [!WARNING]");
    expect(md).toContain("> 雷射電源須維持關閉");
  });

  it("純文字抽取涵蓋 callout 內文（供全文索引）", () => {
    expect(docToPlainText(calloutDoc)).toContain("雷射電源須維持關閉");
  });
});

describe("docToMarkdown/PlainText 分頁節點（D-12，F-EDIT-13）", () => {
  const tabsDoc: ProseMirrorDoc = {
    type: "doc",
    content: [
      {
        type: "tabs",
        content: [
          {
            type: "tabItem",
            attrs: { label: "Windows 安裝" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "下載安裝檔並執行" }] }],
          },
          {
            type: "tabItem",
            attrs: { label: "macOS 安裝" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "拖曳至應用程式資料夾" }] }],
          },
        ],
      },
    ],
  };

  it("Markdown 序列化含分頁標題與內文", () => {
    const md = docToMarkdown(tabsDoc);
    expect(md).toContain("**Windows 安裝**");
    expect(md).toContain("下載安裝檔並執行");
    expect(md).toContain("**macOS 安裝**");
    expect(md).toContain("拖曳至應用程式資料夾");
  });

  it("純文字抽取涵蓋分頁標題（供全文索引/RAG）", () => {
    const text = docToPlainText(tabsDoc);
    for (const s of ["Windows 安裝", "下載安裝檔並執行", "macOS 安裝", "拖曳至應用程式資料夾"]) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain("**");
  });
});

describe("docToMarkdown/PlainText 摺疊節點（D-12，F-EDIT-13）", () => {
  const detailsDoc: ProseMirrorDoc = {
    type: "doc",
    content: [
      {
        type: "details",
        attrs: { summary: "常見問題", open: false },
        content: [{ type: "paragraph", content: [{ type: "text", text: "請聯絡技術支援" }] }],
      },
    ],
  };

  it("Markdown 序列化含摘要標題與內文", () => {
    const md = docToMarkdown(detailsDoc);
    expect(md).toContain("**常見問題**");
    expect(md).toContain("請聯絡技術支援");
  });

  it("純文字抽取涵蓋摘要標題（供全文索引/RAG）", () => {
    const text = docToPlainText(detailsDoc);
    expect(text).toContain("常見問題");
    expect(text).toContain("請聯絡技術支援");
  });
});

describe("docToMarkdown/PlainText 步驟節點（D-12，F-EDIT-13）", () => {
  const stepperDoc: ProseMirrorDoc = {
    type: "doc",
    content: [
      {
        type: "stepper",
        content: [
          { type: "step", content: [{ type: "paragraph", content: [{ type: "text", text: "接上電源" }] }] },
          { type: "step", content: [{ type: "paragraph", content: [{ type: "text", text: "按下開機鍵" }] }] },
        ],
      },
    ],
  };

  it("Markdown 序列化為有序清單（依步驟順序編號）", () => {
    const md = docToMarkdown(stepperDoc);
    expect(md).toContain("1. 接上電源");
    expect(md).toContain("2. 按下開機鍵");
  });

  it("純文字抽取涵蓋步驟內文（供全文索引/RAG）", () => {
    const text = docToPlainText(stepperDoc);
    expect(text).toContain("接上電源");
    expect(text).toContain("按下開機鍵");
  });
});

describe("docToMarkdown/PlainText Mermaid 節點（D-13，F-EDIT-14）", () => {
  const mermaidDoc: ProseMirrorDoc = {
    type: "doc",
    content: [
      {
        type: "mermaid",
        attrs: { source: "graph TD\n  設計 --> 製造" },
      },
    ],
  };

  it("序列化為 ```mermaid fenced 區塊（保留原始碼供匯出/RAG）", () => {
    const md = docToMarkdown(mermaidDoc);
    expect(md).toContain("```mermaid\ngraph TD\n  設計 --> 製造\n```");
  });

  it("純文字抽取涵蓋圖表原始碼（供全文索引/RAG）", () => {
    const text = docToPlainText(mermaidDoc);
    expect(text).toContain("graph TD");
    expect(text).toContain("設計 --> 製造");
    expect(text).not.toContain("```");
  });

  it("source 缺失（資料異常）不炸，序列化為空 fenced 區塊", () => {
    const empty: ProseMirrorDoc = { type: "doc", content: [{ type: "mermaid" }] };
    expect(docToMarkdown(empty)).toContain("```mermaid\n\n```");
    expect(docToPlainText(empty)).toBe("");
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

  it("附件以檔名進全文索引（D-08）", () => {
    const withAttachment: ProseMirrorDoc = {
      type: "doc",
      content: [
        {
          type: "attachment",
          attrs: { attachmentId: "abc-123", fileName: "年度報告.docx", sizeBytes: 4096 },
        },
      ],
    };
    expect(docToPlainText(withAttachment)).toContain("年度報告.docx");
  });
});
