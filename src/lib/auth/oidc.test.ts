import { describe, expect, it } from "vitest";
import {
  OIDC_SCOPE,
  buildAuthorizationUrl,
  configurationFromMetadata,
  isOidcEnabled,
} from "./oidc";

/**
 * B-06 OIDC 單元測試（無網路、不需真 IdP）：
 * - 未設 env → feature flag 關閉。
 * - 以假 issuer 的 Configuration 直接驗證 authorize URL query 組裝正確。
 */

describe("isOidcEnabled（feature flag）", () => {
  it("未設 OIDC env 時為 false（單元測試環境未注入 AUTH_OIDC_*）", () => {
    expect(isOidcEnabled()).toBe(false);
  });
});

describe("buildAuthorizationUrl（authorize URL 組裝）", () => {
  const config = configurationFromMetadata(
    {
      issuer: "https://idp.example.com",
      authorization_endpoint: "https://idp.example.com/oauth2/authorize",
      token_endpoint: "https://idp.example.com/oauth2/token",
    },
    "jetbook-client-id",
    "jetbook-client-secret",
  );

  const url = buildAuthorizationUrl(config, {
    redirectUri: "https://app.example.com/api/auth/oidc/callback",
    state: "state-abc",
    nonce: "nonce-xyz",
    codeChallenge: "challenge-123",
  });

  it("導向 IdP 的 authorization_endpoint", () => {
    expect(url.origin).toBe("https://idp.example.com");
    expect(url.pathname).toBe("/oauth2/authorize");
  });

  it("query 帶正確的 OIDC 授權碼＋PKCE 參數", () => {
    const q = url.searchParams;
    expect(q.get("client_id")).toBe("jetbook-client-id");
    expect(q.get("response_type")).toBe("code");
    expect(q.get("scope")).toBe(OIDC_SCOPE);
    expect(q.get("redirect_uri")).toBe("https://app.example.com/api/auth/oidc/callback");
    expect(q.get("state")).toBe("state-abc");
    expect(q.get("nonce")).toBe("nonce-xyz");
    expect(q.get("code_challenge")).toBe("challenge-123");
    expect(q.get("code_challenge_method")).toBe("S256");
  });

  it("不外洩 client_secret", () => {
    expect(url.toString()).not.toContain("jetbook-client-secret");
  });
});
