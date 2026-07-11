import { describe, expect, it } from "vitest";
import { buildMarkdownImport, titleFromFileName } from "./import-markdown";
import { docToMarkdown, docToPlainText } from "./serialize";
import type { ProseMirrorDoc, ProseMirrorNode } from "./types";

/** 遞迴找出 doc 中第一個指定 type 的節點。 */
function find(node: ProseMirrorNode | ProseMirrorDoc, type: string): ProseMirrorNode | null {
  if ("type" in node && node.type === type) return node as ProseMirrorNode;
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

/**
 * J-01 匯入的內容組裝測試。轉換器本體（markdownToDoc）的完整 fixture 測試見
 * `markdown-to-doc.test.ts`（D-10 共用入口）；此處聚焦匯入層：標題萃取與經
 * 轉換器產出的區塊在匯入情境下正確，且衍生欄位（savePage 三欄來源）保留主要結構。
 */
describe("buildMarkdownImport — 標題萃取（J-01）", () => {
  it("首個 H1 作為頁面標題並自本文移除（避免與閱讀頁 <h1> 重複）", () => {
    const { title, doc } = buildMarkdownImport("# 我的頁面\n\n內容段落。", "x.md");
    expect(title).toBe("我的頁面");
    expect(doc.content?.[0]?.type).toBe("paragraph");
    expect(find(doc, "heading")).toBeNull();
    expect(textOf(doc.content![0]!)).toBe("內容段落。");
  });

  it("無首個 H1 時以檔名（去副檔名）為標題並保留全文", () => {
    const { title, doc } = buildMarkdownImport("## 次標題\n\n內文", "使用手冊.markdown");
    expect(title).toBe("使用手冊");
    expect(doc.content?.[0]?.type).toBe("heading");
    expect(doc.content?.[0]?.attrs?.level).toBe(2);
  });

  it("標題超過上限截斷至 200 字", () => {
    const { title } = buildMarkdownImport(`# ${"x".repeat(300)}`, "f.md");
    expect(title.length).toBe(200);
  });

  it("空內容以檔名為標題、本文為空", () => {
    const { title, doc } = buildMarkdownImport("", "空白.md");
    expect(title).toBe("空白");
    expect(doc.content ?? []).toHaveLength(0);
  });

  it("titleFromFileName 去除路徑與各種 Markdown 副檔名", () => {
    expect(titleFromFileName("dir/sub/報告.md")).toBe("報告");
    expect(titleFromFileName("note.markdown")).toBe("note");
    expect(titleFromFileName("readme")).toBe("readme");
  });
});

describe("匯入 fixture — 常見 Markdown 語法轉對應區塊（F-IE-01 驗收第 1 條）", () => {
  const md = [
    "# 匯入標題",
    "",
    "## 章節",
    "",
    "- 甲",
    "- 乙",
    "",
    "1. 一",
    "2. 二",
    "",
    "- [ ] 未完成",
    "- [x] 已完成",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
    "| 名稱 | 數量 |",
    "| --- | --- |",
    "| 蘋果 | 3 |",
  ].join("\n");
  const { title, doc } = buildMarkdownImport(md, "fixture.md");

  it("標題取自首個 H1", () => {
    expect(title).toBe("匯入標題");
  });

  it("標題（H2）、清單、有序清單、任務清單、程式碼、表格皆轉為對應區塊節點", () => {
    expect(find(doc, "heading")?.attrs?.level).toBe(2);
    expect(find(doc, "bulletList")).not.toBeNull();
    expect(find(doc, "orderedList")).not.toBeNull();
    const task = find(doc, "taskList");
    expect(task).not.toBeNull();
    expect(task!.content?.[0]?.attrs?.checked).toBe(false);
    expect(task!.content?.[1]?.attrs?.checked).toBe(true);
    const code = find(doc, "codeBlock")!;
    expect(code.attrs?.language).toBe("ts");
    expect(textOf(code)).toContain("const x = 1;");
    const table = find(doc, "table")!;
    expect(table.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(textOf(table)).toContain("蘋果");
  });

  it("衍生欄位（savePage 三欄來源）保留標題/清單/程式碼/表格", () => {
    // content_md = docToMarkdown(doc)；content_text = docToPlainText(doc)
    const contentMd = docToMarkdown(doc);
    expect(contentMd).toContain("## 章節");
    expect(contentMd).toContain("- 甲");
    expect(contentMd).toContain("```ts");
    expect(contentMd).toContain("| 名稱 | 數量 |");
    const contentText = docToPlainText(doc);
    expect(contentText).toContain("章節");
    expect(contentText).toContain("const x = 1;");
    expect(contentText).toContain("蘋果");
  });
});
