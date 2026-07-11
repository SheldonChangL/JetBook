import { describe, expect, it } from "vitest";
import { blockToText, diffChars, diffDocs, isUnchanged } from "./diff";
import type { ProseMirrorDoc, ProseMirrorNode } from "./types";

const para = (text: string): ProseMirrorNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const heading = (level: number, text: string): ProseMirrorNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

const doc = (...blocks: ProseMirrorNode[]): ProseMirrorDoc => ({ type: "doc", content: blocks });

describe("diffChars（字級中文 diff）", () => {
  it("相同文字全為 equal", () => {
    expect(diffChars("安裝指南", "安裝指南")).toEqual([{ type: "equal", text: "安裝指南" }]);
  });

  it("兩空字串回傳空陣列", () => {
    expect(diffChars("", "")).toEqual([]);
  });

  it("中文以「字」為單位：只換一個字", () => {
    // 「請先預熱」→「請先加熱」：預→加
    const tokens = diffChars("請先預熱", "請先加熱");
    expect(tokens).toEqual([
      { type: "equal", text: "請先" },
      { type: "delete", text: "預" },
      { type: "insert", text: "加" },
      { type: "equal", text: "熱" },
    ]);
  });

  it("中文純新增（插入詞）", () => {
    const tokens = diffChars("烤箱溫度", "烤箱預熱溫度");
    expect(tokens).toEqual([
      { type: "equal", text: "烤箱" },
      { type: "insert", text: "預熱" },
      { type: "equal", text: "溫度" },
    ]);
  });

  it("中文純刪除（刪掉詞）", () => {
    const tokens = diffChars("烤箱預熱溫度", "烤箱溫度");
    expect(tokens).toEqual([
      { type: "equal", text: "烤箱" },
      { type: "delete", text: "預熱" },
      { type: "equal", text: "溫度" },
    ]);
  });

  it("整段替換：先刪後增", () => {
    const tokens = diffChars("甲乙丙", "丁戊己");
    expect(tokens).toEqual([
      { type: "delete", text: "甲乙丙" },
      { type: "insert", text: "丁戊己" },
    ]);
  });

  it("從空到有：全為 insert", () => {
    expect(diffChars("", "新內容")).toEqual([{ type: "insert", text: "新內容" }]);
  });

  it("從有到空：全為 delete", () => {
    expect(diffChars("舊內容", "")).toEqual([{ type: "delete", text: "舊內容" }]);
  });

  it("連續同狀態合併為單一 token", () => {
    const tokens = diffChars("abc", "aXYc");
    expect(tokens).toEqual([
      { type: "equal", text: "a" },
      { type: "delete", text: "b" },
      { type: "insert", text: "XY" },
      { type: "equal", text: "c" },
    ]);
  });

  it("中英混排字級 diff", () => {
    const tokens = diffChars("溫度 100 度", "溫度 180 度");
    expect(tokens).toEqual([
      { type: "equal", text: "溫度 1" },
      { type: "delete", text: "0" },
      { type: "insert", text: "8" },
      { type: "equal", text: "0 度" },
    ]);
  });

  it("正確處理代理對（emoji 視為單一字）", () => {
    const tokens = diffChars("狀態🙂好", "狀態😀好");
    expect(tokens).toEqual([
      { type: "equal", text: "狀態" },
      { type: "delete", text: "🙂" },
      { type: "insert", text: "😀" },
      { type: "equal", text: "好" },
    ]);
  });

  it("重建性：equal+delete 還原舊字串、equal+insert 還原新字串", () => {
    const oldText = "捷揚光電內部知識庫";
    const newText = "捷揚光電內部維基系統";
    const tokens = diffChars(oldText, newText);
    const rebuiltOld = tokens
      .filter((t) => t.type !== "insert")
      .map((t) => t.text)
      .join("");
    const rebuiltNew = tokens
      .filter((t) => t.type !== "delete")
      .map((t) => t.text)
      .join("");
    expect(rebuiltOld).toBe(oldText);
    expect(rebuiltNew).toBe(newText);
  });
});

describe("blockToText（區塊純文字抽取）", () => {
  it("段落串接 inline 文字不加分隔", () => {
    const node: ProseMirrorNode = {
      type: "paragraph",
      content: [
        { type: "text", text: "請先" },
        { type: "text", text: "預熱", marks: [{ type: "bold" }] },
        { type: "text", text: "30 分鐘" },
      ],
    };
    expect(blockToText(node)).toBe("請先預熱30 分鐘");
  });

  it("清單子項以換行分隔", () => {
    const node: ProseMirrorNode = {
      type: "bulletList",
      content: [
        { type: "listItem", content: [para("檢查濕度")] },
        { type: "listItem", content: [para("檢查溫度")] },
      ],
    };
    expect(blockToText(node)).toBe("檢查濕度\n檢查溫度");
  });

  it("hardBreak 轉為換行", () => {
    const node: ProseMirrorNode = {
      type: "paragraph",
      content: [{ type: "text", text: "第一行" }, { type: "hardBreak" }, { type: "text", text: "第二行" }],
    };
    expect(blockToText(node)).toBe("第一行\n第二行");
  });
});

describe("diffDocs（區塊級 diff）", () => {
  it("完全相同：全部 equal", () => {
    const a = doc(heading(1, "安裝指南"), para("步驟一"));
    const b = doc(heading(1, "安裝指南"), para("步驟一"));
    const entries = diffDocs(a, b);
    expect(entries.map((e) => e.status)).toEqual(["equal", "equal"]);
    expect(isUnchanged(entries)).toBe(true);
  });

  it("尾端新增區塊：added（綠底）", () => {
    const a = doc(para("步驟一"));
    const b = doc(para("步驟一"), para("步驟二"));
    const entries = diffDocs(a, b);
    expect(entries.map((e) => e.status)).toEqual(["equal", "added"]);
    expect(blockToText(entries[1]!.newBlock!)).toBe("步驟二");
    expect(isUnchanged(entries)).toBe(false);
  });

  it("刪除區塊：removed（紅底刪除線）", () => {
    const a = doc(para("步驟一"), para("步驟二"));
    const b = doc(para("步驟一"));
    const entries = diffDocs(a, b);
    expect(entries.map((e) => e.status)).toEqual(["equal", "removed"]);
    expect(blockToText(entries[1]!.oldBlock!)).toBe("步驟二");
  });

  it("同位置修改：modified（黃底）＋附字級 diff", () => {
    const a = doc(heading(1, "安裝指南"), para("請先預熱"));
    const b = doc(heading(1, "安裝指南"), para("請先加熱"));
    const entries = diffDocs(a, b);
    expect(entries.map((e) => e.status)).toEqual(["equal", "modified"]);
    const modified = entries[1]!;
    expect(modified.inline).toEqual([
      { type: "equal", text: "請先" },
      { type: "delete", text: "預" },
      { type: "insert", text: "加" },
      { type: "equal", text: "熱" },
    ]);
    expect(modified.oldBlock).toBeDefined();
    expect(modified.newBlock).toBeDefined();
  });

  it("中間插入 + 修改混合", () => {
    const a = doc(para("開頭"), para("內容甲"), para("結尾"));
    const b = doc(para("開頭"), para("新段落"), para("內容乙"), para("結尾"));
    const entries = diffDocs(a, b);
    // 開頭 equal；gap 內 removed=[內容甲] added=[新段落,內容乙] → 配對 1 個 modified + 1 個 added；結尾 equal
    expect(entries.map((e) => e.status)).toEqual(["equal", "modified", "added", "equal"]);
    expect(blockToText(entries[2]!.newBlock!)).toBe("內容乙");
  });

  it("區塊重排序：以內容 hash 對齊，不誤判全改", () => {
    const a = doc(para("甲"), para("乙"), para("丙"));
    const b = doc(para("乙"), para("丙"), para("甲"));
    const entries = diffDocs(a, b);
    // LCS(甲乙丙, 乙丙甲) = 乙丙：甲 removed 於首，甲 added 於尾
    const statuses = entries.map((e) => e.status);
    expect(statuses.filter((s) => s === "equal")).toHaveLength(2);
    expect(statuses).toContain("removed");
    expect(statuses).toContain("added");
  });

  it("改 heading level 視為修改（attrs 進 hash）", () => {
    const a = doc(heading(1, "章節"));
    const b = doc(heading(2, "章節"));
    const entries = diffDocs(a, b);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("modified");
  });

  it("行內 mark 改變（粗體）視為修改", () => {
    const a = doc({ type: "paragraph", content: [{ type: "text", text: "重點" }] });
    const b = doc({
      type: "paragraph",
      content: [{ type: "text", text: "重點", marks: [{ type: "bold" }] }],
    });
    const entries = diffDocs(a, b);
    expect(entries[0]!.status).toBe("modified");
    // 純文字未變，字級 diff 全 equal
    expect(entries[0]!.inline).toEqual([{ type: "equal", text: "重點" }]);
  });

  it("空文件對非空：全部 added", () => {
    const entries = diffDocs({ type: "doc", content: [] }, doc(para("一"), para("二")));
    expect(entries.map((e) => e.status)).toEqual(["added", "added"]);
  });

  it("null / undefined doc 視為空文件", () => {
    const entries = diffDocs(null, doc(para("一")));
    expect(entries.map((e) => e.status)).toEqual(["added"]);
    expect(diffDocs(undefined, undefined)).toEqual([]);
    expect(isUnchanged(diffDocs(null, null))).toBe(true);
  });

  it("物件 key 順序不同但內容相同：視為 equal", () => {
    const a: ProseMirrorDoc = {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "標題" }] }],
    };
    const b: ProseMirrorDoc = {
      type: "doc",
      content: [{ content: [{ text: "標題", type: "text" }], attrs: { level: 2 }, type: "heading" }],
    };
    expect(diffDocs(a, b).map((e) => e.status)).toEqual(["equal"]);
  });
});
