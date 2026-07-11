import { describe, it, expect } from "vitest";
import { markdownToDoc, markdownToBlockNodes, looksLikeMarkdown } from "./markdown-to-doc";
import type { ProseMirrorNode } from "./types";

/** node.content（斷言存在），配合 noUncheckedIndexedAccess。 */
function kids(node: ProseMirrorNode): ProseMirrorNode[] {
  expect(node.content).toBeDefined();
  return node.content!;
}

/** node.content[i]（斷言存在）。 */
function child(node: ProseMirrorNode, i: number): ProseMirrorNode {
  const c = kids(node)[i];
  expect(c).toBeDefined();
  return c!;
}

/** 取 doc 的第一個區塊，方便逐塊斷言。 */
function firstBlock(md: string): ProseMirrorNode {
  const doc = markdownToDoc(md);
  expect(doc.type).toBe("doc");
  const first = doc.content?.[0];
  expect(first).toBeDefined();
  return first!;
}

describe("markdownToDoc — 標題", () => {
  it("H1–H3 產出對應 level", () => {
    expect(firstBlock("# 一級")).toEqual({
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "一級" }],
    });
    expect(firstBlock("## 二級")).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(firstBlock("### 三級")).toMatchObject({ type: "heading", attrs: { level: 3 } });
  });

  it("H4 以上一律夾到 level 3（編輯器僅 H1–H3）", () => {
    expect(firstBlock("#### 四級")).toMatchObject({ type: "heading", attrs: { level: 3 } });
    expect(firstBlock("###### 六級")).toMatchObject({ type: "heading", attrs: { level: 3 } });
  });

  it("setext 標題也支援", () => {
    expect(firstBlock("Title\n===")).toMatchObject({ type: "heading", attrs: { level: 1 } });
  });
});

describe("markdownToDoc — 段落與行內 marks", () => {
  it("粗/斜/刪除線/行內碼/連結", () => {
    const p = firstBlock("普通 **粗** *斜* ~~刪~~ `碼` [連結](https://x.com)");
    expect(p.type).toBe("paragraph");
    expect(p.content).toEqual([
      { type: "text", text: "普通 " },
      { type: "text", text: "粗", marks: [{ type: "bold" }] },
      { type: "text", text: " " },
      { type: "text", text: "斜", marks: [{ type: "italic" }] },
      { type: "text", text: " " },
      { type: "text", text: "刪", marks: [{ type: "strike" }] },
      { type: "text", text: " " },
      { type: "text", text: "碼", marks: [{ type: "code" }] },
      { type: "text", text: " " },
      { type: "text", text: "連結", marks: [{ type: "link", attrs: { href: "https://x.com" } }] },
    ]);
  });

  it("巢狀 marks（粗中含斜與連結）", () => {
    const p = firstBlock("**粗 _斜_ [l](http://a)**");
    expect(p.content).toEqual([
      { type: "text", text: "粗 ", marks: [{ type: "bold" }] },
      { type: "text", text: "斜", marks: [{ type: "bold" }, { type: "italic" }] },
      { type: "text", text: " ", marks: [{ type: "bold" }] },
      { type: "text", text: "l", marks: [{ type: "bold" }, { type: "link", attrs: { href: "http://a" } }] },
    ]);
  });

  it("硬換行 → hardBreak；軟換行折成空白", () => {
    const p = firstBlock("行一\\\n行二\n行三");
    expect(p.type).toBe("paragraph");
    expect(p.content).toEqual([
      { type: "text", text: "行一" },
      { type: "hardBreak" },
      { type: "text", text: "行二 行三" },
    ]);
  });

  it("HTML 實體解碼（非行內碼）", () => {
    const p = firstBlock("a &amp; b &lt;c&gt; &#65; &#x42;");
    expect(p.content).toEqual([{ type: "text", text: "a & b <c> A B" }]);
  });

  it("行內碼保留原字元，不解碼實體", () => {
    const p = firstBlock("`a &amp; b`");
    expect(p.content).toEqual([{ type: "text", text: "a &amp; b", marks: [{ type: "code" }] }]);
  });

  it("反斜線跳脫", () => {
    const p = firstBlock("\\* 非斜體 \\`非碼\\`");
    expect(p.content).toEqual([
      { type: "text", text: "*" },
      { type: "text", text: " 非斜體 " },
      { type: "text", text: "`" },
      { type: "text", text: "非碼" },
      { type: "text", text: "`" },
    ]);
  });

  it("外部圖片降級為連結（保留 href，不遺失內容）", () => {
    const p = firstBlock("看圖 ![說明](https://img.png)");
    expect(p.content).toEqual([
      { type: "text", text: "看圖 " },
      { type: "text", text: "說明", marks: [{ type: "link", attrs: { href: "https://img.png" } }] },
    ]);
  });
});

describe("markdownToDoc — 清單", () => {
  it("無序清單", () => {
    expect(firstBlock("- a\n- b")).toEqual({
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
      ],
    });
  });

  it("有序清單（start=1 省略 attrs）", () => {
    const node = firstBlock("1. 一\n2. 二");
    expect(node.type).toBe("orderedList");
    expect(node.attrs).toBeUndefined();
    expect(kids(node)).toHaveLength(2);
  });

  it("有序清單自訂起始值帶入 start", () => {
    const node = firstBlock("3. 三\n4. 四");
    expect(node).toMatchObject({ type: "orderedList", attrs: { start: 3 } });
  });

  it("巢狀清單", () => {
    const node = firstBlock("- 上層\n  - 下層");
    expect(node.type).toBe("bulletList");
    const item = child(node, 0);
    expect(child(item, 0)).toEqual({ type: "paragraph", content: [{ type: "text", text: "上層" }] });
    expect(child(item, 1)).toMatchObject({ type: "bulletList" });
  });

  it("巢狀有序於無序項目內", () => {
    const node = firstBlock("- 上\n  1. 內一\n  2. 內二");
    const nested = child(child(node, 0), 1);
    expect(nested).toMatchObject({ type: "orderedList" });
    expect(kids(nested)).toHaveLength(2);
  });
});

describe("markdownToDoc — 任務清單", () => {
  it("全為任務項 → taskList，checked 對應", () => {
    expect(firstBlock("- [ ] 未完\n- [x] 完成")).toEqual({
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: "未完" }] }],
        },
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "完成" }] }],
        },
      ],
    });
  });

  it("非全為任務項 → 退回 bulletList", () => {
    const node = firstBlock("- [ ] 任務\n- 一般");
    expect(node.type).toBe("bulletList");
  });
});

describe("markdownToDoc — 引用", () => {
  it("引用含多行段落", () => {
    const node = firstBlock("> 第一行\n> 第二行");
    expect(node.type).toBe("blockquote");
    expect(child(node, 0)).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "第一行 第二行" }],
    });
  });

  it("引用內含清單", () => {
    const node = firstBlock("> 引言\n>\n> - a\n> - b");
    expect(node.type).toBe("blockquote");
    expect(kids(node).some((n) => n.type === "bulletList")).toBe(true);
  });
});

describe("markdownToDoc — 程式碼區塊", () => {
  it("帶語言，內容以 text 節點承載", () => {
    expect(firstBlock("```ts\nconst x = 1;\n```")).toEqual({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const x = 1;" }],
    });
  });

  it("無語言 → language: null", () => {
    expect(firstBlock("```\nplain\n```")).toEqual({
      type: "codeBlock",
      attrs: { language: null },
      content: [{ type: "text", text: "plain" }],
    });
  });

  it("空程式碼區塊 → 無 content（PM 文字節點不可為空）", () => {
    expect(firstBlock("```\n```")).toEqual({ type: "codeBlock", attrs: { language: null } });
  });

  it("程式碼內容保留原樣，不當作 markdown 解析", () => {
    const node = firstBlock("```md\n# 井號不是標題\n- 減號不是清單\n```");
    expect(node.content).toEqual([{ type: "text", text: "# 井號不是標題\n- 減號不是清單" }]);
  });
});

describe("markdownToDoc — 表格", () => {
  it("首列為 tableHeader，其餘為 tableCell", () => {
    const node = firstBlock("| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
    expect(node.type).toBe("table");
    expect(kids(node)).toHaveLength(3);
    const header = child(node, 0);
    expect(header.type).toBe("tableRow");
    expect(kids(header).map((c) => c.type)).toEqual(["tableHeader", "tableHeader"]);
    expect(child(header, 0)).toEqual({
      type: "tableHeader",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
    });
    const row = child(node, 1);
    expect(kids(row).map((c) => c.type)).toEqual(["tableCell", "tableCell"]);
    expect(child(row, 1)).toEqual({
      type: "tableCell",
      content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }],
    });
  });

  it("空儲存格仍有段落（tableCell content 為 block+）", () => {
    const node = firstBlock("| A | B |\n|---|---|\n| 1 |  |");
    const emptyCell = child(child(node, 1), 1);
    expect(emptyCell).toEqual({ type: "tableCell", content: [{ type: "paragraph" }] });
  });

  it("儲存格內含行內 marks", () => {
    const node = firstBlock("| 欄 |\n|---|\n| **粗** |");
    const cell = child(child(node, 1), 0);
    expect(child(cell, 0).content).toEqual([{ type: "text", text: "粗", marks: [{ type: "bold" }] }]);
  });
});

describe("markdownToDoc — 水平線與其他", () => {
  it("水平線", () => {
    expect(firstBlock("---")).toEqual({ type: "horizontalRule" });
    expect(firstBlock("***")).toEqual({ type: "horizontalRule" });
  });

  it("空輸入 → 空 doc", () => {
    expect(markdownToDoc("")).toEqual({ type: "doc", content: [] });
    expect(markdownToDoc("   \n  ")).toEqual({ type: "doc", content: [] });
  });

  it("markdownToBlockNodes 回傳純區塊串", () => {
    const nodes = markdownToBlockNodes("# 標題\n\n段落");
    expect(nodes.map((n) => n.type)).toEqual(["heading", "paragraph"]);
  });
});

describe("markdownToDoc — 綜合（F-EDIT-05 驗收：多段含 code block、表格）", () => {
  const md = [
    "# 專案筆記",
    "",
    "這是**重點**與 `inline` 說明。",
    "",
    "## 步驟",
    "",
    "1. 安裝依賴",
    "2. 執行測試",
    "",
    "- [x] 已完成",
    "- [ ] 待辦",
    "",
    "> 提醒：先備份。",
    "",
    "```python",
    "def hello():",
    "    return 'hi'",
    "```",
    "",
    "| 名稱 | 值 |",
    "| --- | --- |",
    "| a | 1 |",
    "| b | 2 |",
    "",
    "---",
    "",
    "結尾段落。",
  ].join("\n");

  it("整份轉換出所有預期區塊型別且順序正確", () => {
    const doc = markdownToDoc(md);
    expect(kids({ type: "doc", content: doc.content }).map((n) => n.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "orderedList",
      "taskList",
      "blockquote",
      "codeBlock",
      "table",
      "horizontalRule",
      "paragraph",
    ]);
  });

  it("code block 保留原始程式（含縮排與換行）", () => {
    const doc = markdownToDoc(md);
    const code = (doc.content ?? []).find((n) => n.type === "codeBlock");
    expect(code).toBeDefined();
    expect(code!.attrs).toEqual({ language: "python" });
    expect(code!.content).toEqual([{ type: "text", text: "def hello():\n    return 'hi'" }]);
  });

  it("表格轉為 header + 2 body rows", () => {
    const doc = markdownToDoc(md);
    const table = (doc.content ?? []).find((n) => n.type === "table");
    expect(table).toBeDefined();
    expect(kids(table!)).toHaveLength(3);
    expect(child(child(table!, 0), 0).type).toBe("tableHeader");
    expect(child(child(table!, 1), 0).type).toBe("tableCell");
  });
});

describe("looksLikeMarkdown", () => {
  it.each([
    "# 標題",
    "- 清單項",
    "* 星號清單",
    "1. 有序",
    "> 引用",
    "```\ncode\n```",
    "| a | b |\n| --- | --- |\n| 1 | 2 |",
    "---",
    "含 **粗體** 的句子",
    "含 `行內碼` 的句子",
    "看[連結](https://x.com)",
  ])("偵測 md 特徵：%s", (text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    "",
    "純文字段落沒有任何標記。",
    "第一行\n第二行\n第三行都是一般文字",
    "價格是 5 * 3 的結果",
    "路徑 a-b-c 與 x_y_z",
  ])("一般文字不誤判：%s", (text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});
