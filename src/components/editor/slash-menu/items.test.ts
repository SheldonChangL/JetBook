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

  it("表格：「表格」/ table 皆命中（D-05）", () => {
    for (const q of ["表格", "table", "grid"]) {
      expect(filterSlashMenuItems(SLASH_MENU_ITEMS, q).map((i) => i.id)).toContain(
        "table",
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

  it("Callout：「提示」/ callout 命中全部四項，kind 關鍵字命中單項（D-06）", () => {
    const allFour = ["calloutInfo", "calloutSuccess", "calloutWarning", "calloutDanger"];
    for (const q of ["提示", "callout"]) {
      expect(filterSlashMenuItems(SLASH_MENU_ITEMS, q).map((i) => i.id)).toEqual(allFour);
    }
    expect(filterSlashMenuItems(SLASH_MENU_ITEMS, "警告").map((i) => i.id)).toEqual([
      "calloutWarning",
    ]);
    expect(filterSlashMenuItems(SLASH_MENU_ITEMS, "danger").map((i) => i.id)).toEqual([
      "calloutDanger",
    ]);
  });

  it("無符合關鍵字回傳空陣列", () => {
    expect(filterSlashMenuItems(SLASH_MENU_ITEMS, "zzz不存在")).toEqual([]);
  });

  it("Tabs/摺疊/Stepper：中英文關鍵字命中對應項（D-12）", () => {
    for (const q of ["分頁", "頁籤", "tabs", "tab"]) {
      expect(filterSlashMenuItems(SLASH_MENU_ITEMS, q).map((i) => i.id)).toContain(
        "tabs",
      );
    }
    for (const q of ["摺疊", "折疊", "收合", "details", "collapse", "toggle"]) {
      expect(filterSlashMenuItems(SLASH_MENU_ITEMS, q).map((i) => i.id)).toContain(
        "details",
      );
    }
    for (const q of ["步驟", "流程", "stepper", "step"]) {
      expect(filterSlashMenuItems(SLASH_MENU_ITEMS, q).map((i) => i.id)).toContain(
        "stepper",
      );
    }
  });

  it("Mermaid：「圖表」/「流程圖」/ mermaid / diagram 皆命中（D-13）", () => {
    for (const q of ["圖表", "流程圖", "mermaid", "diagram", "flowchart"]) {
      expect(filterSlashMenuItems(SLASH_MENU_ITEMS, q).map((i) => i.id)).toContain(
        "mermaid",
      );
    }
  });

  it("Embed：「嵌入」/「內嵌」/ embed / youtube / figma 皆命中（D-14）", () => {
    for (const q of ["嵌入", "內嵌", "embed", "youtube", "figma", "iframe"]) {
      expect(filterSlashMenuItems(SLASH_MENU_ITEMS, q).map((i) => i.id)).toContain(
        "embed",
      );
    }
  });

  it("涵蓋所有已實作區塊（D-01/D-03/D-04/D-05/D-06/D-08/D-12/D-13/D-14 現有節點）且 group 合法", () => {
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
      "table",
      "calloutInfo",
      "calloutSuccess",
      "calloutWarning",
      "calloutDanger",
      "tabs",
      "details",
      "stepper",
      "mermaid",
      "embed",
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
