import type { SpaceRole } from "@/lib/db/schema";

/**
 * 純授權決策邏輯（無 DB 依賴，可單元測試）。
 * permission.ts 在此之上加資料存取（getSpaceRole / getAccessiblePageIds）。
 */

export type Action =
  | "space.read"
  | "space.edit"
  | "space.manage"
  | "page.read"
  | "page.edit"
  | "page.comment"
  | "page.delete";

/** 各動作所需的最低 space 角色。 */
export const REQUIRED_ROLE: Record<Action, SpaceRole> = {
  "space.read": "viewer",
  "space.edit": "editor",
  "space.manage": "admin",
  "page.read": "viewer",
  "page.comment": "commenter",
  "page.edit": "editor",
  "page.delete": "editor",
};

const ROLE_RANK: Record<SpaceRole, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  admin: 3,
};

export function roleAtLeast(role: SpaceRole | null, required: SpaceRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/** 給定 space 角色是否可執行動作。 */
export function actionAllowedForRole(action: Action, role: SpaceRole | null): boolean {
  return roleAtLeast(role, REQUIRED_ROLE[action]);
}

/**
 * 封存 space 唯讀（F-ORG-04）：封存後內容唯讀，僅允許讀取與管理動作
 * （space.manage 供管理者解除封存／刪除）。其餘寫入動作（編輯、評論、刪頁）一律拒絕。
 */
const ARCHIVED_ALLOWED_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "space.read",
  "space.manage",
  "page.read",
]);

/** 動作在「封存 space」下是否仍被允許（唯讀＋管理）。 */
export function actionAllowedWhenArchived(action: Action): boolean {
  return ARCHIVED_ALLOWED_ACTIONS.has(action);
}
