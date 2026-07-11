import { describe, expect, it } from "vitest";
import { parseEmails } from "./groups";

/**
 * CSV email 解析（K-03，F-ADMIN-02）純函式單元測試——不依賴 DB。
 */
describe("parseEmails（CSV 批次匯入解析）", () => {
  it("支援逗號、分號、空白與換行混合分隔", () => {
    const input = "a@x.com, b@x.com;c@x.com\nd@x.com\t e@x.com";
    expect(parseEmails(input)).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
      "d@x.com",
      "e@x.com",
    ]);
  });

  it("轉小寫、去重、保留首次出現順序", () => {
    expect(parseEmails("A@X.com, a@x.com, B@x.COM")).toEqual(["a@x.com", "b@x.com"]);
  });

  it("濾掉不含 @ 的雜訊與空白", () => {
    expect(parseEmails("  , notanemail, real@x.com ,  ; ")).toEqual(["real@x.com"]);
  });

  it("空字串回空陣列", () => {
    expect(parseEmails("")).toEqual([]);
    expect(parseEmails("   \n  ")).toEqual([]);
  });
});
