import { describe, expect, it } from "vitest";
import {
  getArchiveSidebarPresentation,
  shouldShowArchiveGlobalDock,
} from "@/lib/archive-navigation";

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

  it("uses one expanded sidebar on global routes instead of a separate rail plus dock", () => {
    expect(getArchiveSidebarPresentation("/", false, false)).toBe("expanded");
    expect(getArchiveSidebarPresentation("/spaces", false, false)).toBe("expanded");
  });

  it("uses a compact rail when the global dock is hidden", () => {
    expect(getArchiveSidebarPresentation("/", true, false)).toBe("compact");
    expect(getArchiveSidebarPresentation("/s/handbook", false, false)).toBe("compact");
  });
});
