import { describe, expect, it } from "vitest";
import {
  CALLOUT_KINDS,
  DEFAULT_CALLOUT_KIND,
  isCalloutKind,
  normalizeCalloutKind,
} from "./callout";

describe("callout kind 白名單守衛（D-06）", () => {
  it("恰四種語意 kind（順序固定）", () => {
    expect(CALLOUT_KINDS).toEqual(["info", "success", "warning", "danger"]);
    expect(DEFAULT_CALLOUT_KIND).toBe("info");
  });

  it("isCalloutKind 僅接受白名單（預設拒絕）", () => {
    for (const k of CALLOUT_KINDS) expect(isCalloutKind(k)).toBe(true);
    for (const bad of ["", "INFO", "note", "hint", null, undefined, 1, {}]) {
      expect(isCalloutKind(bad)).toBe(false);
    }
  });

  it("normalizeCalloutKind：合法值原樣返回，非法值回落預設", () => {
    expect(normalizeCalloutKind("warning")).toBe("warning");
    expect(normalizeCalloutKind("danger")).toBe("danger");
    expect(normalizeCalloutKind("bogus")).toBe(DEFAULT_CALLOUT_KIND);
    expect(normalizeCalloutKind(null)).toBe("info");
    expect(normalizeCalloutKind(undefined)).toBe("info");
  });
});
