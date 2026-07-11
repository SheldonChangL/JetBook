import { describe, expect, it } from "vitest";
import { markdownToDoc } from "./markdown-to-doc";
import { buildMarkdownImport, titleFromFileName } from "./import-markdown";
import { docToMarkdown, docToPlainText } from "./serialize";
import type { ProseMirrorNode } from "./types";

/** 遞迴找出 doc 中第一個指定 type 的節點。 */
function find(node: ProseMirrorNode, type: string): ProseMirrorNode | null {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const hit = find(child, type);
    if (hit) return hit;
  }
  return null;
}

function textOf(node: ProseMirrorNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(textOf).join("");
}

describe("markdownToDoc — 區塊轉換（F-IE-01 驗收第 1 條）", () => {
  it("ATX 標題轉為 heading，並將 >H3 降級為 H3", () => {
    const doc = markdownToDoc("# 一級\n\n## 二級\n\n#### 四級（降級為 3）");
    const headings = (doc.content ?? []).filter((n) => n.type === "heading");
    expect(headings.map((h) => h.attrs?.level)).toEqual([1, 2, 3]);
    expect(textOf(headings[0]!)).toBe("一級");
  });

  it("無序清單（含巢狀）轉為 bulletList / listItem", () => {
    const doc = markdownToDoc("- 甲\n- 乙\n  - 乙一\n- 丙");
    const list = find({ type: "doc", content: doc.content }, "bulletList")!;
    expect(list.type).toBe("bulletList");
    // 三個頂層項目
    expect((list.content ?? []).length).toBe(3);
    // 第二個項目內含巢狀 bulletList
    const nested = find(list.content![1]!, "bulletList");
    expect(nested).not.toBeNull();
    expect(textOf(nested!)).toContain("乙一");
  });

  it("有序清單轉為 orderedList", () => {
    const doc = markdownToDoc("1. 第一\n2. 第二");
    const list = find({ type: "doc", content: doc.content }, "orderedList")!;
    expect(list.type).toBe("orderedList");
    expect((list.content ?? []).length).toBe(2);
  });

  it("任務清單轉為 taskList / taskItem 並保留勾選狀態", () => {
    const doc = markdownToDoc("- [ ] 未完成\n- [x] 已完成");
    const list = find({ type: "doc", content: doc.content }, "taskList")!;
    expect(list.type).toBe("taskList");
    expect(list.content?.[0]?.attrs?.checked).toBe(false);
    expect(list.content?.[1]?.attrs?.checked).toBe(true);
  });

  it("圍欄程式碼區塊保留語言與原文", () => {
    const doc = markdownToDoc("```ts\nconst x = 1;\nconsole.log(x);\n```");
    const code = find({ type: "doc", content: doc.content }, "codeBlock")!;
    expect(code.attrs?.language).toBe("ts");
    expect(textOf(code)).toBe("const x = 1;\nconsole.log(x);");
  });

  it("GFM 表格轉為 table / tableHeader / tableCell", () => {
    const doc = markdownToDoc("| 名稱 | 數量 |\n| --- | --- |\n| 蘋果 | 3 |\n| 香蕉 | 5 |");
    const table = find({ type: "doc", content: doc.content }, "table")!;
    expect(table.type).toBe("table");
    const rows = table.content ?? [];
    expect(rows.length).toBe(3); // 表頭 + 兩列
    expect(rows[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(rows[1]?.content?.[0]?.type).toBe("tableCell");
    expect(textOf(rows[2]!)).toContain("香蕉");
  });

  it("單獨一行的圖片轉為 image 區塊", () => {
    const doc = markdownToDoc('![替代文字](https://example.com/a.png "標題")');
    const img = find({ type: "doc", content: doc.content }, "image")!;
    expect(img.attrs?.src).toBe("https://example.com/a.png");
    expect(img.attrs?.alt).toBe("替代文字");
    expect(img.attrs?.title).toBe("標題");
  });

  it("引用轉為 blockquote", () => {
    const doc = markdownToDoc("> 一段引用\n> 第二行");
    const quote = find({ type: "doc", content: doc.content }, "blockquote")!;
    expect(quote.type).toBe("blockquote");
    expect(textOf(quote)).toContain("一段引用");
  });

  it("GitHub admonition 引用轉為 callout（保留 kind）", () => {
    const doc = markdownToDoc("> [!WARNING]\n> 小心");
    const callout = find({ type: "doc", content: doc.content }, "callout")!;
    expect(callout.type).toBe("callout");
    expect(callout.attrs?.kind).toBe("warning");
    expect(textOf(callout)).toContain("小心");
  });

  it("水平線轉為 horizontalRule", () => {
    const doc = markdownToDoc("上\n\n---\n\n下");
    expect(find({ type: "doc", content: doc.content }, "horizontalRule")).not.toBeNull();
  });

  it("行內標記：粗體/斜體/刪除線/行內碼/連結", () => {
    const doc = markdownToDoc(
      "這是**粗**與*斜*與~~刪~~與`碼`與[連結](https://e.com)。",
    );
    const para = find({ type: "doc", content: doc.content }, "paragraph")!;
    const marks = new Set<string>();
    for (const child of para.content ?? []) {
      for (const m of child.marks ?? []) marks.add(m.type);
    }
    expect(marks).toEqual(new Set(["bold", "italic", "strike", "code", "link"]));
    const link = (para.content ?? []).find((n) => n.marks?.some((m) => m.type === "link"));
    expect(link?.marks?.find((m) => m.type === "link")?.attrs?.href).toBe("https://e.com");
  });

  it("空字串轉為空 doc", () => {
    expect(markdownToDoc("")).toEqual({ type: "doc", content: [] });
  });
});

describe("markdownToDoc — 衍生欄位（三欄同步的來源）", () => {
  // savePage 以 docToMarkdown/docToPlainText 產生 content_md/content_text；
  // 這裡驗證匯入 doc 經衍生後三種語法皆保留（round-trip 主要結構不失）。
  const md = [
    "# 標題",
    "",
    "段落含**粗體**。",
    "",
    "- 項目",
    "",
    "```py\nprint(1)\n```",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
  ].join("\n");
  const doc = markdownToDoc(md);

  it("docToMarkdown round-trip 保留標題/清單/程式碼/表格", () => {
    const out = docToMarkdown(doc);
    expect(out).toContain("# 標題");
    expect(out).toContain("**粗體**");
    expect(out).toContain("- 項目");
    expect(out).toContain("```py");
    expect(out).toContain("| A | B |");
    expect(out).toContain("| 1 | 2 |");
  });

  it("docToPlainText 供全文索引，含表格與程式碼文字", () => {
    const text = docToPlainText(doc);
    expect(text).toContain("標題");
    expect(text).toContain("print(1)");
    expect(text).toContain("項目");
  });
});

describe("buildMarkdownImport — 標題萃取（J-01）", () => {
  it("首個 H1 作為標題並自本文移除（避免與閱讀頁 h1 重複）", () => {
    const { title, doc } = buildMarkdownImport("# 我的頁面\n\n內容段落。", "x.md");
    expect(title).toBe("我的頁面");
    // 本文第一個節點不再是該 H1
    expect(doc.content?.[0]?.type).toBe("paragraph");
    expect(find(doc, "heading")).toBeNull();
    expect(textOf(doc.content![0]!)).toBe("內容段落。");
  });

  it("無首個 H1 時以檔名（去副檔名）為標題並保留全文", () => {
    const { title, doc } = buildMarkdownImport("## 次標題\n\n內文", "使用手冊.markdown");
    expect(title).toBe("使用手冊");
    // 全文保留，首節點為 H2
    expect(doc.content?.[0]?.type).toBe("heading");
    expect(doc.content?.[0]?.attrs?.level).toBe(2);
  });

  it("標題超過上限截斷至 200 字", () => {
    const long = "x".repeat(300);
    const { title } = buildMarkdownImport(`# ${long}`, "f.md");
    expect(title.length).toBe(200);
  });

  it("titleFromFileName 去除路徑與各種 Markdown 副檔名", () => {
    expect(titleFromFileName("dir/sub/報告.md")).toBe("報告");
    expect(titleFromFileName("note.markdown")).toBe("note");
    expect(titleFromFileName("readme")).toBe("readme");
  });
});
