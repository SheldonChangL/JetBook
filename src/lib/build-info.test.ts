import { describe, expect, it } from "vitest";
import { resolveBuildInfo } from "./build-info";

describe("resolveBuildInfo", () => {
  it("使用注入的 build-arg 值（模擬 CI／部署 image）", () => {
    expect(
      resolveBuildInfo({
        appVersion: "1.2.3",
        gitCommit: "1b0a23d0f9e8c7b6a5d4e3f2a1b0c9d8e7f6a5b4",
        buildTime: "2026-07-17T08:00:00Z",
        packageVersion: "0.1.0",
      }),
    ).toEqual({
      version: "1.2.3",
      commit: "1b0a23d0f9e8c7b6a5d4e3f2a1b0c9d8e7f6a5b4",
      shortCommit: "1b0a23d",
      builtAt: "2026-07-17T08:00:00Z",
    });
  });

  it("未注入時 fallback：version 取 package.json、commit=dev、builtAt 空", () => {
    expect(resolveBuildInfo({ packageVersion: "0.1.0" })).toEqual({
      version: "0.1.0",
      commit: "dev",
      shortCommit: "dev",
      builtAt: "",
    });
  });

  it("空字串／空白 build-arg 視同未注入（Docker 預設空 ARG）", () => {
    expect(
      resolveBuildInfo({
        appVersion: "  ",
        gitCommit: "",
        buildTime: "   ",
        packageVersion: "0.1.0",
      }),
    ).toEqual({
      version: "0.1.0",
      commit: "dev",
      shortCommit: "dev",
      builtAt: "",
    });
  });

  it("APP_VERSION 覆寫 package.json version", () => {
    expect(resolveBuildInfo({ appVersion: "2.0.0", packageVersion: "0.1.0" }).version).toBe("2.0.0");
  });

  it("commit 短碼取前 7 碼", () => {
    expect(resolveBuildInfo({ gitCommit: "abcdef1234567", packageVersion: "0.1.0" }).shortCommit).toBe(
      "abcdef1",
    );
  });
});
