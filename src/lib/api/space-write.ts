import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaces, type SpaceRole, type SpaceVisibility } from "@/lib/db/schema";
import { can, type Actor } from "@/lib/authz/permission";
import { createSpaceCore } from "@/lib/spaces/create";
import {
  findActiveUserByEmail,
  setSpaceMemberRole,
  updateSpaceFields,
  type SpaceUpdateFields,
} from "@/lib/spaces/manage";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * API 空間寫入（M4-13 起）：MCP 工具與 REST v1 共用的 lib 層薄核心。
 * - 建立重用 createSpaceCore（唯一建立路徑）：slug 自動產生、建立者同交易成 space admin。
 * - 更新／成員重用 lib/spaces/manage 的共用核心（與 web action 同一路徑，避免漂移）。
 * - 權限：更新與成員管理需 space.manage（space admin）；一律走 lib/authz 的 can()。
 *   不存在與無權回同一種 outcome（NOT_FOUND_OR_FORBIDDEN）以防枚舉。
 * - scope 檢查（write）與限流由呼叫端薄殼（MCP writeGate／REST requireApiAuth）負責。
 */

/** 對齊 web createSchema 的長度上限（MCP 與 REST 薄殼共用，避免各寫一份漂移）。 */
export const SPACE_NAME_MAX_CHARS = 100;
export const SPACE_DESCRIPTION_MAX_CHARS = 500;

export interface ApiCreateSpaceInput {
  name: string;
  description?: string;
  /** 省略＝private（沿用 schema 預設，與 web 建立流程一致）。 */
  visibility?: SpaceVisibility;
}

export interface ApiSpaceRef {
  id: string;
  slug: string;
  name: string;
  visibility: SpaceVisibility;
}

export async function apiCreateSpace(user: Actor, input: ApiCreateSpaceInput): Promise<ApiSpaceRef> {
  const space = await createSpaceCore(user.id, input);

  logger.info({ userId: user.id, spaceId: space.id }, "space created via api");
  await writeAudit({
    actorId: user.id,
    action: "space.api_create",
    targetType: "space",
    targetId: space.id,
    metadata: { name: space.name, slug: space.slug, visibility: space.visibility, via: "api" },
    ip: null,
  });

  return { id: space.id, slug: space.slug, name: space.name, visibility: space.visibility };
}

/** 空間定位：MCP 傳 spaceId、REST 傳 spaceSlug（同 apiCreatePage 慣例，擇一）。 */
export interface SpaceRef {
  spaceId?: string;
  spaceSlug?: string;
}

/**
 * 解析並授權可管理的空間：以 id 或 slug 定位 → 排除軟刪 → 驗 space.manage。
 * 不存在／已刪／無權一律回 null（呼叫端統一回 NOT_FOUND_OR_FORBIDDEN，防枚舉）。
 */
async function resolveManageableSpace(user: Actor, ref: SpaceRef) {
  const space = ref.spaceId
    ? await db.query.spaces.findFirst({ where: eq(spaces.id, ref.spaceId) })
    : ref.spaceSlug
      ? await db.query.spaces.findFirst({ where: eq(spaces.slug, ref.spaceSlug) })
      : null;
  if (!space || space.deletedAt) return null;
  if (!(await can(user, "space.manage", { type: "space", spaceId: space.id }))) return null;
  return space;
}

export type ApiUpdateSpaceInput = SpaceRef & {
  name?: string;
  description?: string | null;
  icon?: string | null;
  visibility?: SpaceVisibility;
};

export type ApiUpdateSpaceOutcome =
  | { ok: true; space: ApiSpaceRef }
  | { ok: false; error: "NOT_FOUND_OR_FORBIDDEN" };

/**
 * 更新空間（名稱／描述／icon／可見度）。需 space.manage；不存在或無權一律回
 * NOT_FOUND_OR_FORBIDDEN（防枚舉）。呼叫端須先確保至少提供一個欄位。
 */
export async function apiUpdateSpace(
  user: Actor,
  input: ApiUpdateSpaceInput,
): Promise<ApiUpdateSpaceOutcome> {
  const { spaceId, spaceSlug, ...fields } = input;
  const space = await resolveManageableSpace(user, { spaceId, spaceSlug });
  if (!space) return { ok: false, error: "NOT_FOUND_OR_FORBIDDEN" };

  await updateSpaceFields(space.id, fields as SpaceUpdateFields);

  const row = (await db.query.spaces.findFirst({ where: eq(spaces.id, space.id) })) ?? space;
  await writeAudit({
    actorId: user.id,
    action: "space.api_update",
    targetType: "space",
    targetId: space.id,
    metadata: { fields, via: "api" },
    ip: null,
  });

  return {
    ok: true,
    space: { id: row.id, slug: row.slug, name: row.name, visibility: row.visibility },
  };
}

export type ApiSetSpaceMemberInput = SpaceRef & {
  email: string;
  /** null＝移除成員。 */
  role: SpaceRole | null;
};

export type ApiSetSpaceMemberOutcome =
  | { ok: true; email: string; role: SpaceRole | null }
  | { ok: false; error: "NOT_FOUND_OR_FORBIDDEN" | "USER_NOT_FOUND" | "LAST_ADMIN" };

/**
 * 設定／移除空間成員角色（以 email 指定使用者）。需 space.manage；role=null 移除。
 * 不存在空間或無權回 NOT_FOUND_OR_FORBIDDEN；查無使用者回 USER_NOT_FOUND；
 * 不可移除／降級最後一位 admin（LAST_ADMIN）。
 */
export async function apiSetSpaceMember(
  user: Actor,
  input: ApiSetSpaceMemberInput,
): Promise<ApiSetSpaceMemberOutcome> {
  const space = await resolveManageableSpace(user, {
    spaceId: input.spaceId,
    spaceSlug: input.spaceSlug,
  });
  if (!space) return { ok: false, error: "NOT_FOUND_OR_FORBIDDEN" };

  const target = await findActiveUserByEmail(input.email);
  if (!target) return { ok: false, error: "USER_NOT_FOUND" };

  try {
    await setSpaceMemberRole(space.id, target.id, input.role);
  } catch (err) {
    if (err instanceof Error && err.message === "LAST_ADMIN") {
      return { ok: false, error: "LAST_ADMIN" };
    }
    throw err;
  }

  await writeAudit({
    actorId: user.id,
    action: "space.api_member_set",
    targetType: "space",
    targetId: space.id,
    metadata: { memberId: target.id, email: input.email, role: input.role, via: "api" },
    ip: null,
  });

  return { ok: true, email: input.email, role: input.role };
}
