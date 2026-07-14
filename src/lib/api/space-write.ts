import "server-only";
import type { Actor } from "@/lib/authz/permission";
import { createSpaceCore } from "@/lib/spaces/create";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * API 建立空間（M4-13，issue #218）：MCP 工具與 REST v1 共用的 lib 層。
 * - 重用 createSpaceCore（唯一建立路徑）：slug 自動產生（重名自動加尾碼，
 *   不回錯誤——與 web 端一致，不為 API 另開自訂 slug 驗證面）、
 *   建立者同交易成為該 space admin。
 * - 權限模型同 web：任何已認證使用者皆可建立空間（無額外 authz action）；
 *   scope 檢查（write）由呼叫端薄殼負責。
 */

export interface ApiCreateSpaceInput {
  name: string;
  description?: string;
}

export interface ApiSpaceRef {
  id: string;
  slug: string;
  name: string;
}

export async function apiCreateSpace(user: Actor, input: ApiCreateSpaceInput): Promise<ApiSpaceRef> {
  const space = await createSpaceCore(user.id, input);

  logger.info({ userId: user.id, spaceId: space.id }, "space created via api");
  await writeAudit({
    actorId: user.id,
    action: "space.api_create",
    targetType: "space",
    targetId: space.id,
    metadata: { name: space.name, slug: space.slug, via: "api" },
    ip: null,
  });

  return { id: space.id, slug: space.slug, name: space.name };
}
