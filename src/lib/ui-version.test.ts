import { describe, expect, it } from "vitest";
import { canSwitchUiVersion, resolveUiVersion } from "./ui-version";

describe("resolveUiVersion", () => {
  it("forces Legacy when rollout is off, even with an Archive cookie", () => {
    expect(resolveUiVersion("off", "archive")).toBe("legacy");
  });

  it("defaults to Legacy in opt-in mode", () => {
    expect(resolveUiVersion("opt-in", undefined)).toBe("legacy");
    expect(resolveUiVersion("opt-in", "invalid")).toBe("legacy");
  });

  it("honors either user choice in opt-in mode", () => {
    expect(resolveUiVersion("opt-in", "archive")).toBe("archive");
    expect(resolveUiVersion("opt-in", "legacy")).toBe("legacy");
  });

  it("defaults to Archive when rollout is on", () => {
    expect(resolveUiVersion("on", undefined)).toBe("archive");
    expect(resolveUiVersion("on", "invalid")).toBe("archive");
  });

  it("keeps the Legacy escape hatch when rollout is on", () => {
    expect(resolveUiVersion("on", "legacy")).toBe("legacy");
    expect(resolveUiVersion("on", "archive")).toBe("archive");
  });
});

describe("canSwitchUiVersion", () => {
  it("hides the user switch while the global kill switch is off", () => {
    expect(canSwitchUiVersion("off")).toBe(false);
  });

  it("allows a user choice during opt-in and on rollout", () => {
    expect(canSwitchUiVersion("opt-in")).toBe(true);
    expect(canSwitchUiVersion("on")).toBe(true);
  });
});
