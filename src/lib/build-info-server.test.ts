import { afterEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";

/**
 * getBuildInfo 端到端：驗證 env.ts 注入的 build metadata 被讀取並解析（含 fallback）。
 * 只 mock 邊界 @/lib/env（模擬 build 階段 ARG→ENV 的結果），走真實 resolveBuildInfo 與 package.json。
 */
const h = vi.hoisted(() => ({
  env: {} as { APP_VERSION?: string; GIT_COMMIT?: string; BUILD_TIME?: string },
}));
vi.mock("@/lib/env", () => ({ env: h.env }));

import { getBuildInfo } from "./build-info-server";

afterEach(() => {
  h.env.APP_VERSION = undefined;
  h.env.GIT_COMMIT = undefined;
  h.env.BUILD_TIME = undefined;
});

describe("getBuildInfo", () => {
  it("讀取注入的環境變數（模擬部署 image 的 build-arg）", () => {
    h.env.APP_VERSION = "1.4.0";
    h.env.GIT_COMMIT = "1b0a23d0f9e8c7b6a5d4e3f2a1b0c9d8e7f6a5b4";
    h.env.BUILD_TIME = "2026-07-17T08:00:00Z";
    expect(getBuildInfo()).toEqual({
      version: "1.4.0",
      commit: "1b0a23d0f9e8c7b6a5d4e3f2a1b0c9d8e7f6a5b4",
      shortCommit: "1b0a23d",
      builtAt: "2026-07-17T08:00:00Z",
    });
  });

  it("未注入時 fallback 至 package.json version、commit=dev、builtAt 空", () => {
    expect(getBuildInfo()).toEqual({
      version: pkg.version,
      commit: "dev",
      shortCommit: "dev",
      builtAt: "",
    });
  });
});
