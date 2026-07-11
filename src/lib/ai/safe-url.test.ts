import { describe, expect, it } from "vitest";
import { safeUrl } from "./safe-url";

describe("safeUrl", () => {
  it("放行 http/https 絕對連結", () => {
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeUrl("http://intranet/doc")).toBe("http://intranet/doc");
  });

  it("放行 mailto", () => {
    expect(safeUrl("mailto:help@jet-opto.com.tw")).toBe("mailto:help@jet-opto.com.tw");
  });

  it("放行站內相對連結與錨點", () => {
    expect(safeUrl("/s/space/page")).toBe("/s/space/page");
    expect(safeUrl("#section")).toBe("#section");
    expect(safeUrl("./relative")).toBe("./relative");
  });

  it("擋下 javascript: 協定（XSS）", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeUrl("  javascript:alert(1)  ")).toBeNull();
  });

  it("擋下 data:／vbscript: 協定", () => {
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("空值回 null", () => {
    expect(safeUrl("")).toBeNull();
    expect(safeUrl("   ")).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});
