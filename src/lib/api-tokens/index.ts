import "server-only";
import { createHash, randomBytes } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiTokens, users, type ApiToken, type User } from "@/lib/db/schema";

/**
 * API Token 商業邏輯（M4-06，F-API-02）。
 * - 明文格式 `jbk_<base64url 32B>`；僅建立當下回傳一次，DB 只存 sha256。
 * - 驗證：hash 查表 → 未撤銷、未過期、擁有者啟用中 → 回擁有者（權限走既有 lib/authz）。
 * - scopes："read"（唯讀端點/工具）；"write"（M4-09，建立/更新頁面）為選配，
 *   建立 token 時明確勾選才發，且必含 read。
 */

export const API_TOKEN_SCOPES = ["read", "write"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

const TOKEN_PREFIX = "jbk_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface ApiTokenView {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface CreateApiTokenInput {
  name: string;
  scopes: ApiTokenScope[];
  /** null＝永不過期 */
  expiresAt: Date | null;
}

/** 建立 token；回傳明文（僅此一次）與檢視列。 */
export async function createApiToken(
  userId: string,
  input: CreateApiTokenInput,
): Promise<{ token: string; row: ApiTokenView }> {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [row] = await db
    .insert(apiTokens)
    .values({
      userId,
      name: input.name,
      tokenHash: hashToken(token),
      scopes: input.scopes,
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) throw new Error("API token 建立失敗");
  return { token, row: toView(row) };
}

function toView(row: ApiToken): ApiTokenView {
  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

/** 列出使用者未撤銷的 token（含已過期，UI 標示）。 */
export async function listApiTokens(userId: string): Promise<ApiTokenView[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
  return rows.map(toView);
}

/** 撤銷（僅限本人 token）；成功回 true，不存在/非本人回 false。 */
export async function revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
  const [updated] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)),
    )
    .returning({ id: apiTokens.id });
  return updated !== undefined;
}

export type VerifiedApiToken = {
  tokenId: string;
  scopes: string[];
  user: Pick<User, "id" | "orgRole" | "email" | "name">;
};

/**
 * 驗證 Bearer token：hash 查表＋未撤銷＋未過期＋擁有者啟用中。
 * 通過即更新 last_used_at（best-effort）。失敗一律回 null（不區分原因，避免枚舉）。
 */
export async function verifyApiToken(token: string): Promise<VerifiedApiToken | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db
    .select({
      id: apiTokens.id,
      scopes: apiTokens.scopes,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      userId: users.id,
      orgRole: users.orgRole,
      email: users.email,
      userName: users.name,
      isActive: users.isActive,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, hashToken(token)))
    .limit(1);

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  if (!row.isActive) return null;

  // last_used_at 為觀測性資訊：更新失敗不影響驗證結果
  void db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id))
    .catch(() => {});

  return {
    tokenId: row.id,
    scopes: row.scopes,
    user: { id: row.userId, orgRole: row.orgRole, email: row.email, name: row.userName },
  };
}
