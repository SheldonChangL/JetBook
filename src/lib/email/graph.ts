import "server-only";
import { env } from "@/lib/env";
import type { EmailMessage } from "./types";

/**
 * Microsoft Graph `sendMail` provider（#280，ADR-015）。
 * 部署環境的對外防火牆封鎖全部 SMTP 埠（25／465／587），HTTPS 443 可用，故改由 Graph 寄信。
 *
 * 認證走 client credentials（application 權限 `Mail.Send`），以寄件信箱身分寄出。
 * 純邏輯與 env 讀取分離（比照 lib/auth/oidc）：`createGraphMailer` 接受明確 config 與可注入的
 * fetch，故單元測試不需真租戶與網路。
 */

const LOGIN_BASE = "https://login.microsoftonline.com";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_RESOURCE = "https://graph.microsoft.com";

/** token 提前更新的安全邊界：避免在有效期邊緣送出、送達 Graph 時已過期 */
const EXPIRY_SKEW_MS = 60_000;

/** 錯誤回應節錄上限：夠診斷即可，避免把整份 HTML 錯誤頁灌進 log */
const ERROR_DETAIL_LIMIT = 300;

export interface GraphMailConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** 寄件信箱 UPN；Graph 以此信箱身分寄出，需具 Exchange Online 授權 */
  sender: string;
}

/** 帶 HTTP 狀態與 Graph request-id 的錯誤；訊息不含任何憑證 */
export class GraphMailError extends Error {
  readonly status?: number;
  readonly requestId?: string;

  constructor(message: string, options: { status?: number; requestId?: string } = {}) {
    super(message);
    this.name = "GraphMailError";
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

export interface GraphMailer {
  sendMail(message: EmailMessage): Promise<void>;
}

interface TokenSuccess {
  access_token: string;
  expires_in: number;
}

interface TokenFailure {
  error?: string;
  error_description?: string;
  error_codes?: number[];
}

/** 由 env 組出 config；任一欄缺漏即視為未設定（回 null） */
export function graphConfigFromEnv(): GraphMailConfig | null {
  const tenantId = env.GRAPH_TENANT_ID;
  const clientId = env.GRAPH_CLIENT_ID;
  const clientSecret = env.GRAPH_CLIENT_SECRET;
  const sender = env.GRAPH_SENDER;
  if (!tenantId || !clientId || !clientSecret || !sender) return null;
  return { tenantId, clientId, clientSecret, sender };
}

export function createGraphMailer(
  config: GraphMailConfig,
  deps: { fetchImpl?: typeof fetch } = {},
): GraphMailer {
  const doFetch = deps.fetchImpl ?? fetch;

  // 行程內 token 快取：單純 memo（各 instance 自持、可隨時重建），不是跨請求的共享狀態，
  // 不違反 web／worker stateless 約束——比照原 SMTP transporter 的 module-level 快取。
  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function requestToken(): Promise<string> {
    const res = await doFetch(`${LOGIN_BASE}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: `${GRAPH_RESOURCE}/.default`,
        grant_type: "client_credentials",
      }),
    });

    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const failure = (body ?? {}) as TokenFailure;
      // error_description 不含 client secret；保留首行供診斷（如 AADSTS7000215 憑證錯誤）
      const reason = failure.error_description?.split("\n")[0] ?? failure.error ?? "未知錯誤";
      throw new GraphMailError(`取得 Graph token 失敗（HTTP ${res.status}）：${reason}`, {
        status: res.status,
      });
    }

    const success = body as TokenSuccess | null;
    if (!success?.access_token) {
      throw new GraphMailError("取得 Graph token 失敗：回應缺少 access_token", {
        status: res.status,
      });
    }

    cached = {
      token: success.access_token,
      expiresAt: Date.now() + success.expires_in * 1000 - EXPIRY_SKEW_MS,
    };
    return success.access_token;
  }

  async function getToken(forceRefresh = false): Promise<string> {
    if (forceRefresh) {
      cached = null;
      inflight = null;
    }
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    // 併發去重：一次寄多封時只換一次 token
    inflight ??= requestToken().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function post(token: string, message: EmailMessage): Promise<Response> {
    const body = message.html
      ? { contentType: "HTML", content: message.html }
      : { contentType: "Text", content: message.text };
    return doFetch(`${GRAPH_BASE}/users/${encodeURIComponent(config.sender)}/sendMail`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: message.subject,
          body,
          toRecipients: [{ emailAddress: { address: message.to } }],
        },
        saveToSentItems: true,
      }),
    });
  }

  async function sendMail(message: EmailMessage): Promise<void> {
    let res = await post(await getToken(), message);
    // token 可能因輪替或撤銷提前失效：401 強制換新後只重試一次，避免無界重試
    if (res.status === 401) {
      res = await post(await getToken(true), message);
    }
    if (res.status !== 202) {
      const requestId = res.headers.get("request-id") ?? undefined;
      const detail = await res.text().catch(() => "");
      throw new GraphMailError(
        `Graph sendMail 失敗（HTTP ${res.status}）：${detail.slice(0, ERROR_DETAIL_LIMIT)}`,
        { status: res.status, requestId },
      );
    }
  }

  return { sendMail };
}
