import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, parseCsv, parseUsersCsv } from "./user-import";

describe("parseCsv（最小 RFC 4180）", () => {
  it("逗號分欄、LF/CRLF 換行", () => {
    expect(parseCsv("a,b\r\nc,d\ne,f")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });

  it("引號欄位可含逗號與換行，雙引號跳脫", () => {
    expect(parseCsv('a,"x, y",\"he said \"\"hi\"\"\"\n1,"multi\nline",2')).toEqual([
      ["a", "x, y", 'he said "hi"'],
      ["1", "multi\nline", "2"],
    ]);
  });

  it("容忍 UTF-8 BOM 與尾端空白列", () => {
    expect(parseCsv("﻿email\na@x.com\n\n")).toEqual([["email"], ["a@x.com"]]);
  });
});

describe("parseUsersCsv（M4-02 欄名對映與逐列驗證）", () => {
  it("標準欄位：email,name,org_role；admin/管理員 視為管理員", () => {
    const res = parseUsersCsv("email,name,org_role\na@x.com,張三,admin\nb@x.com,李四,管理員\nc@x.com,王五,member");
    if (!res.ok) throw new Error(res.error);
    expect(res.rows.map((r) => r.orgRole)).toEqual(["admin", "admin", "member"]);
    expect(res.rows[0]).toMatchObject({ line: 2, email: "a@x.com", name: "張三" });
  });

  it("Redmine 匯出欄名：First name/Last name 合併（CJK 姓前名後）；未知角色值為 member", () => {
    const res = parseUsersCsv("Email,First name,Last name,Role\na@x.com,三,張,Developer");
    if (!res.ok) throw new Error(res.error);
    expect(res.rows[0]).toMatchObject({ email: "a@x.com", name: "張三", orgRole: "member" });
  });

  it("西文名以「名 姓」空格合併", () => {
    const res = parseUsersCsv("email,first name,last name\na@x.com,John,Smith");
    if (!res.ok) throw new Error(res.error);
    expect(res.rows[0]?.name).toBe("John Smith");
  });

  it("name 缺漏以 email local part 代替；email 轉小寫", () => {
    const res = parseUsersCsv("email\nShELdon@X.com");
    if (!res.ok) throw new Error(res.error);
    expect(res.rows[0]).toMatchObject({ email: "sheldon@x.com", name: "sheldon" });
  });

  it("email 格式錯誤與檔內重複逐列標示，不影響其他列", () => {
    const res = parseUsersCsv("email,name\nbad-email,X\na@x.com,A\nA@x.com,重複");
    if (!res.ok) throw new Error(res.error);
    expect(res.rows.map((r) => r.error)).toEqual(["INVALID_EMAIL", undefined, "DUPLICATE_IN_FILE"]);
  });

  it("無 email 欄回 NO_EMAIL_COLUMN；只有標題列回 EMPTY_FILE", () => {
    expect(parseUsersCsv("name,role\nA,admin")).toEqual({ ok: false, error: "NO_EMAIL_COLUMN" });
    expect(parseUsersCsv("email,name")).toEqual({ ok: false, error: "EMPTY_FILE" });
  });

  it(`超過 ${MAX_IMPORT_ROWS} 列回 TOO_MANY_ROWS`, () => {
    const lines = ["email", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `u${i}@x.com`)];
    expect(parseUsersCsv(lines.join("\n"))).toEqual({ ok: false, error: "TOO_MANY_ROWS" });
  });
});
