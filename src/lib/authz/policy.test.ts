import { describe, expect, it } from "vitest";
import { actionAllowedForRole, roleAtLeast, type Action } from "./policy";
import type { SpaceRole } from "@/lib/db/schema";

const ROLES: (SpaceRole | null)[] = [null, "viewer", "commenter", "editor", "admin"];

describe("roleAtLeast", () => {
  it("null 一律不足", () => {
    expect(roleAtLeast(null, "viewer")).toBe(false);
  });
  it("同級與更高級通過、較低級不通過", () => {
    expect(roleAtLeast("editor", "editor")).toBe(true);
    expect(roleAtLeast("admin", "editor")).toBe(true);
    expect(roleAtLeast("viewer", "editor")).toBe(false);
    expect(roleAtLeast("commenter", "editor")).toBe(false);
  });
});

describe("actionAllowedForRole 權限矩陣（所有動作 × 所有角色）", () => {
  // 期望矩陣：action → 能通過的最低角色
  const expected: Record<Action, Record<string, boolean>> = {
    "space.read": { null: false, viewer: true, commenter: true, editor: true, admin: true },
    "page.read": { null: false, viewer: true, commenter: true, editor: true, admin: true },
    "page.comment": { null: false, viewer: false, commenter: true, editor: true, admin: true },
    "space.edit": { null: false, viewer: false, commenter: false, editor: true, admin: true },
    "page.edit": { null: false, viewer: false, commenter: false, editor: true, admin: true },
    "page.delete": { null: false, viewer: false, commenter: false, editor: true, admin: true },
    "space.manage": { null: false, viewer: false, commenter: false, editor: false, admin: true },
  };

  for (const action of Object.keys(expected) as Action[]) {
    for (const role of ROLES) {
      const key = role ?? "null";
      it(`${action} × ${key} = ${expected[action][key]}`, () => {
        expect(actionAllowedForRole(action, role)).toBe(expected[action][key]);
      });
    }
  }
});
