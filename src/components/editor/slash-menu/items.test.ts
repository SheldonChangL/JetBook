import { describe, expect, it } from "vitest";
import {
  filterSlashMenuItems,
  SLASH_MENU_GROUP_ORDER,
  SLASH_MENU_ITEMS,
} from "./items";

describe("filterSlashMenuItems（F-EDIT-02 中英文關鍵字過濾）", () => {
  it("空 query 回傳全部項目", () => {
    expect(filterSlashMenuItems(SLASH_MENU_ITEMS, "")).toHaveLength(
      SLASH_MENU_ITEMS.length,
    );
    expect(filterSlashMenuItems(SLASH_MENU_ITEMS, "  ")).toHaveLength(
      SLASH_MENU_ITEMS.length,
    );
  });

  it("中文關鍵字命中（「標題」→ H1–H3）", () => {
    const ids = filterSlashMenuItems(SLASH_MENU_ITEMS, "標題").map((i) => i.id);
    expect(ids).toEqual(["heading1", "heading2", "heading3"]);
  });

  it("英文關鍵字命中（heading → H1–H3；大小寫不敏感）", () => {
    const ids = filterSlashMenuItems(SLASH_MENU_ITEMS, "HeAdInG").map(
      (i) => i.id,
    );
    expect(ids).toEqual(["heading1", "heading2", "heading3"]);
  });

  it("同一區塊中英文皆可命中（任務清單：「任務」與 task）", () => {
    for (const q of ["任務", "task", "todo", "待辦"]) {
      expect(filterSlashMenuItems(SLASH_MENU_ITEMS, q).map((i) => i.id)).toContain(
        "taskList",
      );
    }
  });

  it("部分字串命中（「分隔」→ 分隔線；hr → 分隔線）", () => {
    expect(filterSlashMenuItems(SLASH_MENU_ITEMS, "分隔").map((i) => i.id)).toEqual([
      "divider",
    ]);
    expect(filterSlashMenuItems(SLASH_MENU_ITEMS, "hr").map((i) => i.id)).toEqual([
      "divider",
    ]);
  });

  it("程式碼區塊：「程式碼」/ code 皆命中", () => {
    for (const q of ["程式碼", "code", "代碼"]) {
      expect(filterSlashMenuItems(SLASH_MENU_ITEMS, q).map((i) => i.id)).toContain(
        "codeBlock",
      );
    }
  });

  it("附件區塊：「檔案」/「附件」/ file 皆命中（D-08）", () => {
    for (const q of ["檔案", "附件", "file", "attachment", "上傳"]) {
      expect(filterSlashMenuItems(SLASH_MENU_ITEMS, q).map((i) => i.id)).toContain(
        "attachment",
      );
    }
  });

  it("無符合關鍵字回傳空陣列", () => {
    expect(filterSlashMenuItems(SLASH_MENU_ITEMS, "zzz不存在")).toEqual([]);
  });

  it("涵蓋所有已實作區塊（D-01/D-03/D-08 現有節點）且 group 合法", () => {
    const ids = SLASH_MENU_ITEMS.map((i) => i.id);
    expect(ids).toEqual([
      "text",
      "heading1",
      "heading2",
      "heading3",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "divider",
      "codeBlock",
      "attachment",
    ]);
    for (const item of SLASH_MENU_ITEMS) {
      expect(SLASH_MENU_GROUP_ORDER).toContain(item.group);
      expect(item.keywords.length).toBeGreaterThan(0);
      // 每個項目中英文關鍵字皆須涵蓋（F-EDIT-02）
      expect(item.keywords.some((k) => /[一-鿿]/.test(k))).toBe(true);
      expect(item.keywords.some((k) => /^[\x20-\x7e]+$/.test(k))).toBe(true);
    }
  });
});
