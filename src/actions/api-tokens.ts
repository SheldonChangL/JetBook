"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireSession } from "@/lib/auth/current";
import {
  API_TOKEN_SCOPES,
  createApiToken,
  revokeApiToken,
  type ApiTokenView,
} from "@/lib/api-tokens";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * API Token 管理 server actions（M4-06，F-API-02）薄殼：驗 session → lib。
 * 建立/撤銷寫入 audit_logs（敏感操作）。
 */

/** 到期日選項（天）；0＝永不過期。 */
const EXPIRY_DAYS = [30, 90, 365, 0] as const;

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiryDays: z
    .number()
    .int()
    .refine((v): v is (typeof EXPIRY_DAYS)[number] =>
      (EXPIRY_DAYS as readonly number[]).includes(v),
    ),
  /** M4-09：允許寫入（建立/更新頁面）；預設唯讀。 */
  allowWrite: z.boolean().default(false),
});

export type CreateTokenResult =
  | { ok: true; token: string; row: ApiTokenView }
  | { ok: false; error: "invalid" };

export async function createApiTokenAction(input: {
  name: string;
  expiryDays: number;
  allowWrite?: boolean;
}): Promise<CreateTokenResult> {
  const { user } = await requireSession();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const expiresAt =
    parsed.data.expiryDays === 0
      ? null
      : new Date(Date.now() + parsed.data.expiryDays * 24 * 60 * 60 * 1000);

  const { token, row } = await createApiToken(user.id, {
    name: parsed.data.name,
    // write 必含 read（寫入流程需先讀）；唯讀為預設
    scopes: parsed.data.allowWrite ? [...API_TOKEN_SCOPES] : ["read"],
    expiresAt,
  });

  await writeAudit({
    actorId: user.id,
    action: "api_token.create",
    targetType: "api_token",
    targetId: row.id,
    metadata: { name: row.name, expiresAt: row.expiresAt, scopes: row.scopes },
    ip: ipFromHeaders(await headers()),
  });
  logger.info({ userId: user.id, tokenId: row.id }, "api token created");

  revalidatePath("/settings");
  return { ok: true, token, row };
}

const revokeSchema = z.object({ tokenId: z.uuid() });

export type RevokeTokenResult = { ok: true } | { ok: false; error: "not_found" | "invalid" };

export async function revokeApiTokenAction(input: {
  tokenId: string;
}): Promise<RevokeTokenResult> {
  const { user } = await requireSession();
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const revoked = await revokeApiToken(user.id, parsed.data.tokenId);
  if (!revoked) return { ok: false, error: "not_found" };

  await writeAudit({
    actorId: user.id,
    action: "api_token.revoke",
    targetType: "api_token",
    targetId: parsed.data.tokenId,
    ip: ipFromHeaders(await headers()),
  });
  logger.info({ userId: user.id, tokenId: parsed.data.tokenId }, "api token revoked");

  revalidatePath("/settings");
  return { ok: true };
}
