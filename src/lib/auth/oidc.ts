import "server-only";
import * as client from "openid-client";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { env } from "@/lib/env";

/**
 * OIDC 身分來源（B-06 預留）。
 *
 * lib/auth 職責（constraints §3）：local 帳密為預設身分來源，OIDC（SSO）為另一實作，
 * 兩者共用同一 `users` 表與 DB-backed session——OIDC 登入成功後一律換發「本地 session」，
 * 不引入第二套 session 機制。
 *
 * 未設定 env（issuer / client_id / client_secret 任一缺）時 `isConfigured()` 為 false：
 * 授權路由回 404、登入頁不顯示 SSO 按鈕（feature flag）。
 *
 * 授權碼流程採 PKCE（S256）＋ state＋nonce；伺服器端只快取一次 discovery 結果。
 */

/** OIDC 要求的 scope：OpenID Connect 基本身分 + email + profile（取 name）。 */
export const OIDC_SCOPE = "openid email profile";
/** SSO 路由前綴（cookie path 與登入頁連結共用此常數，單一來源）。 */
export const OIDC_BASE_PATH = "/api/auth/oidc";
/** callback 路徑（redirect_uri 未由 env 指定時據此與 BASE_URL 推導）。 */
export const OIDC_CALLBACK_PATH = `${OIDC_BASE_PATH}/callback`;

/** 授權交易期間綁定 user-agent 的一次性防護值（存短效 cookie，callback 驗證）。 */
export const OIDC_STATE_COOKIE = "jetbook_oidc_state";
export const OIDC_NONCE_COOKIE = "jetbook_oidc_nonce";
export const OIDC_VERIFIER_COOKIE = "jetbook_oidc_verifier";

/** 外部 IdP 回傳並經驗證的身分（自 ID Token claims 擷取）。 */
export interface FederatedIdentity {
  /** IdP 內穩定不變的使用者識別（對應 users.oidc_subject）。 */
  subject: string;
  email: string;
  name: string;
}

/** 一次授權請求需隨 user-agent 綁定、並於 callback 比對的檢查值。 */
export interface AuthorizationChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface AuthorizationRequest extends AuthorizationChecks {
  /** 導向 IdP 的完整 authorize URL。 */
  authorizationUrl: string;
}

/**
 * 身分來源抽象。OIDC 為其一實作；未來如需其他 SSO 協定，實作同介面即可，
 * 上層（路由、登入頁）只依賴介面與 `isConfigured()` feature flag。
 */
export interface IdentityProvider {
  /** provider 識別碼（寫入 users.auth_provider 的值）。 */
  readonly id: "oidc";
  /** env 是否完整設定；未設定即停用。 */
  isConfigured(): boolean;
  /** 產生授權請求：組出 authorize URL 與待寫入 cookie 的 state/nonce/PKCE。 */
  createAuthorizationRequest(): Promise<AuthorizationRequest>;
  /** 以 callback URL（含 code）與先前檢查值換發 token，回傳外部身分。 */
  completeAuthorization(currentUrl: URL, checks: AuthorizationChecks): Promise<FederatedIdentity>;
}

/** redirect_uri：env 指定優先，否則由 BASE_URL 推導 callback 絕對網址。 */
function resolveRedirectUri(): string {
  return env.AUTH_OIDC_REDIRECT_URI ?? new URL(OIDC_CALLBACK_PATH, env.BASE_URL).toString();
}

/**
 * 以顯式 server metadata 建立 Configuration（跳過 discovery，無網路）。
 * 正式流程一律走 discovery；此函式用於離線情境（驗證 authorize URL 組裝、
 * 或未來對接不支援 discovery 的 IdP），確保 Configuration 與 buildAuthorizationUrl
 * 來自同一 openid-client 實例（instanceof 檢查）。
 */
export function configurationFromMetadata(
  metadata: { issuer: string; authorization_endpoint: string; token_endpoint?: string },
  clientId: string,
  clientSecret?: string,
): client.Configuration {
  return new client.Configuration(metadata, clientId, clientSecret);
}

/**
 * 由 Configuration 組出 authorize URL（純函式，無網路）。
 * 抽出以便以假 issuer 的 Configuration 直接驗證 query 組裝正確性。
 */
export function buildAuthorizationUrl(
  config: client.Configuration,
  params: { redirectUri: string; state: string; nonce: string; codeChallenge: string },
): URL {
  return client.buildAuthorizationUrl(config, {
    redirect_uri: params.redirectUri,
    scope: OIDC_SCOPE,
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
}

class OidcIdentityProvider implements IdentityProvider {
  readonly id = "oidc" as const;
  /** discovery 結果快取：設定於程序生命週期內不變，僅探索一次。 */
  #configuration: Promise<client.Configuration> | null = null;

  isConfigured(): boolean {
    return Boolean(
      env.AUTH_OIDC_ISSUER && env.AUTH_OIDC_CLIENT_ID && env.AUTH_OIDC_CLIENT_SECRET,
    );
  }

  #discover(): Promise<client.Configuration> {
    const issuer = env.AUTH_OIDC_ISSUER;
    const clientId = env.AUTH_OIDC_CLIENT_ID;
    const clientSecret = env.AUTH_OIDC_CLIENT_SECRET;
    if (!issuer || !clientId || !clientSecret) {
      throw new Error("OIDC 未設定：缺少 AUTH_OIDC_ISSUER / CLIENT_ID / CLIENT_SECRET");
    }
    this.#configuration ??= client.discovery(new URL(issuer), clientId, clientSecret);
    return this.#configuration;
  }

  async createAuthorizationRequest(): Promise<AuthorizationRequest> {
    const config = await this.#discover();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const url = buildAuthorizationUrl(config, {
      redirectUri: resolveRedirectUri(),
      state,
      nonce,
      codeChallenge,
    });
    return { authorizationUrl: url.toString(), state, nonce, codeVerifier };
  }

  async completeAuthorization(
    currentUrl: URL,
    checks: AuthorizationChecks,
  ): Promise<FederatedIdentity> {
    const config = await this.#discover();
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
    });
    const claims = tokens.claims();
    if (!claims) {
      throw new Error("OIDC 回應缺少 ID Token claims");
    }
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    if (!email) {
      throw new Error("OIDC 回應缺少 email claim");
    }
    const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email;
    return { subject: claims.sub, email, name };
  }
}

/** 預設 OIDC provider 單例。 */
export const oidcProvider: IdentityProvider = new OidcIdentityProvider();

/** feature flag：SSO 是否啟用（路由與登入頁共用）。 */
export function isOidcEnabled(): boolean {
  return oidcProvider.isConfigured();
}

/**
 * 依外部身分 upsert 使用者（auth_provider=oidc）。
 * 解析順序：oidc_subject 命中 → email 命中（連結既有本地帳號）→ 新建。
 * email 由受信任的內部 IdP 提供，作為既有帳號連結依據。
 */
export async function upsertOidcUser(identity: FederatedIdentity): Promise<User> {
  const bySubject = await db.query.users.findFirst({
    where: eq(users.oidcSubject, identity.subject),
  });
  if (bySubject) {
    if (bySubject.name !== identity.name) {
      const [updated] = await db
        .update(users)
        .set({ name: identity.name, updatedAt: new Date() })
        .where(eq(users.id, bySubject.id))
        .returning();
      return updated ?? bySubject;
    }
    return bySubject;
  }

  const byEmail = await db.query.users.findFirst({ where: eq(users.email, identity.email) });
  if (byEmail) {
    const [linked] = await db
      .update(users)
      .set({
        authProvider: "oidc",
        oidcSubject: identity.subject,
        name: identity.name,
        updatedAt: new Date(),
      })
      .where(eq(users.id, byEmail.id))
      .returning();
    if (!linked) {
      throw new Error("OIDC 帳號連結失敗");
    }
    return linked;
  }

  const [created] = await db
    .insert(users)
    .values({
      email: identity.email,
      name: identity.name,
      authProvider: "oidc",
      oidcSubject: identity.subject,
    })
    .returning();
  if (!created) {
    throw new Error("OIDC 使用者建立失敗");
  }
  return created;
}
