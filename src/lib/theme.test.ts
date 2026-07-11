import { describe, expect, it } from "vitest";
import { normalizeTheme } from "./theme";

/**
 * normalizeTheme（G-03）：root layout SSR 依此把 DB 偏好轉成 Theme 以決定掛載的 html class。
 * 非 light/dark 一律 system（含 NULL 未設定、舊值、空字串），確保 SSR 不會誤掛 dark。
 */
describe("normalizeTheme", () => {
  it("字面值 light / dark 原樣保留", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
  });

  it("NULL / undefined（未設定）視為 system", () => {
    expect(normalizeTheme(null)).toBe("system");
    expect(normalizeTheme(undefined)).toBe("system");
  });

  it("system 字面值與任意非法舊值一律 system", () => {
    expect(normalizeTheme("system")).toBe("system");
    expect(normalizeTheme("")).toBe("system");
    expect(normalizeTheme("Dark")).toBe("system");
    expect(normalizeTheme("auto")).toBe("system");
  });
});
