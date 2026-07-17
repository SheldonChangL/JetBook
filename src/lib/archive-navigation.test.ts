import { describe, expect, it } from "vitest";
import { shouldShowArchiveGlobalDock } from "@/lib/archive-navigation";

describe("shouldShowArchiveGlobalDock", () => {
  it("shows the global dock on non-Space routes when it is expanded", () => {
    expect(shouldShowArchiveGlobalDock("/spaces", false, false)).toBe(true);
  });

  it("suppresses the global dock by default inside a Space workspace", () => {
    expect(shouldShowArchiveGlobalDock("/s/handbook", false, false)).toBe(false);
  });

  it("allows the global dock to be temporarily expanded inside a Space workspace", () => {
    expect(shouldShowArchiveGlobalDock("/s/handbook/settings", false, true)).toBe(true);
  });

  it("keeps a persisted collapsed dock hidden on every route", () => {
    expect(shouldShowArchiveGlobalDock("/", true, true)).toBe(false);
    expect(shouldShowArchiveGlobalDock("/s/handbook", true, true)).toBe(false);
  });
});
