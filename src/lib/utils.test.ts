import { describe, expect, it } from "vitest";
import { decodeRouteParam } from "./utils";

describe("decodeRouteParam", () => {
  it("還原 percent-encoded CJK slug（中英混合標題，issue #207）", () => {
    expect(decodeRouteParam("e2e-%E5%8C%AF%E5%85%A5%E6%B8%AC%E8%A9%A6%E6%96%87%E4%BB%B6")).toBe(
      "e2e-匯入測試文件",
    );
  });

  it("純 ASCII slug 原樣通過", () => {
    expect(decodeRouteParam("getting-started-2")).toBe("getting-started-2");
  });

  it("非法編碼不擲錯，回傳原值（交由呼叫端 404）", () => {
    expect(decodeRouteParam("%zz")).toBe("%zz");
  });
});
