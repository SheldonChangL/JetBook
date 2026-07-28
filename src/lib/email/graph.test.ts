import { describe, expect, it, vi } from "vitest";
import { createGraphMailer, GraphMailError, type GraphMailConfig } from "./graph";

/**
 * #280 Graph sendMail 單元測試（無網路、不需真租戶）：以注入的 fetch 驗證
 * token 快取重用、401 重試、錯誤診斷資訊，以及憑證不外洩。
 */

const config: GraphMailConfig = {
  tenantId: "tenant-abc",
  clientId: "client-abc",
  clientSecret: "super-secret-value",
  sender: "no-reply@example.com",
};

const message = { to: "user@example.com", subject: "主旨", text: "內文" };

const tokenOk = (expiresIn = 3600) =>
  new Response(JSON.stringify({ access_token: "token-1", expires_in: expiresIn }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const accepted = () => new Response(null, { status: 202, headers: { "request-id": "req-1" } });

const isTokenCall = (url: string) => url.includes("login.microsoftonline.com");

describe("createGraphMailer：token 取得與快取", () => {
  it("首封信換一次 token，後續信件重用快取不再換", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      isTokenCall(String(input)) ? tokenOk() : accepted(),
    );
    const mailer = createGraphMailer(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    await mailer.sendMail(message);
    await mailer.sendMail(message);
    await mailer.sendMail(message);

    const tokenCalls = fetchImpl.mock.calls.filter(([url]) => isTokenCall(String(url)));
    const sendCalls = fetchImpl.mock.calls.filter(([url]) => !isTokenCall(String(url)));
    expect(tokenCalls).toHaveLength(1);
    expect(sendCalls).toHaveLength(3);
  });

  it("併發寄送只換一次 token（in-flight 去重）", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      isTokenCall(String(input)) ? tokenOk() : accepted(),
    );
    const mailer = createGraphMailer(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    await Promise.all([mailer.sendMail(message), mailer.sendMail(message), mailer.sendMail(message)]);

    expect(fetchImpl.mock.calls.filter(([url]) => isTokenCall(String(url)))).toHaveLength(1);
  });

  it("token 已屆期（含安全邊界）時重新取得", async () => {
    // expires_in 30 秒 < EXPIRY_SKEW_MS(60s) → 取得當下即視為過期，每封都重換
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      isTokenCall(String(input)) ? tokenOk(30) : accepted(),
    );
    const mailer = createGraphMailer(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    await mailer.sendMail(message);
    await mailer.sendMail(message);

    expect(fetchImpl.mock.calls.filter(([url]) => isTokenCall(String(url)))).toHaveLength(2);
  });

  it("token 端點失敗時拋出可診斷錯誤，且不含 client secret", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "invalid_client",
            error_description: "AADSTS7000215: Invalid client secret provided.\nTrace ID: x",
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );
    const mailer = createGraphMailer(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(mailer.sendMail(message)).rejects.toThrowError(GraphMailError);
    await expect(mailer.sendMail(message)).rejects.toThrowError(/AADSTS7000215/);
    await expect(mailer.sendMail(message)).rejects.not.toThrowError(/super-secret-value/);
  });
});

describe("createGraphMailer：寄送請求", () => {
  it("以寄件信箱為路徑、帶 Bearer token 與純文字內容", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      isTokenCall(String(input)) ? tokenOk() : accepted(),
    );
    const mailer = createGraphMailer(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    await mailer.sendMail(message);

    const [url, init] = fetchImpl.mock.calls.find(([u]) => !isTokenCall(String(u))) as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://graph.microsoft.com/v1.0/users/no-reply%40example.com/sendMail");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-1");

    const payload = JSON.parse(init.body as string);
    expect(payload.message.subject).toBe("主旨");
    expect(payload.message.body).toEqual({ contentType: "Text", content: "內文" });
    expect(payload.message.toRecipients).toEqual([
      { emailAddress: { address: "user@example.com" } },
    ]);
    expect(payload.saveToSentItems).toBe(true);
  });

  it("提供 html 時以 HTML 內容寄出", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      isTokenCall(String(input)) ? tokenOk() : accepted(),
    );
    const mailer = createGraphMailer(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    await mailer.sendMail({ ...message, html: "<p>內文</p>" });

    const [, init] = fetchImpl.mock.calls.find(([u]) => !isTokenCall(String(u))) as unknown as [
      string,
      RequestInit,
    ];
    const payload = JSON.parse(init.body as string);
    expect(payload.message.body).toEqual({ contentType: "HTML", content: "<p>內文</p>" });
  });

  it("401 時強制換新 token 並重試一次即成功", async () => {
    let sendAttempts = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (isTokenCall(String(input))) return tokenOk();
      sendAttempts += 1;
      return sendAttempts === 1 ? new Response(null, { status: 401 }) : accepted();
    });
    const mailer = createGraphMailer(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(mailer.sendMail(message)).resolves.toBeUndefined();
    expect(sendAttempts).toBe(2);
    expect(fetchImpl.mock.calls.filter(([url]) => isTokenCall(String(url)))).toHaveLength(2);
  });

  it("重試後仍 401 即拋錯，不無限重試", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      isTokenCall(String(input)) ? tokenOk() : new Response("unauthorized", { status: 401 }),
    );
    const mailer = createGraphMailer(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(mailer.sendMail(message)).rejects.toThrowError(GraphMailError);
    expect(fetchImpl.mock.calls.filter(([url]) => !isTokenCall(String(url)))).toHaveLength(2);
  });

  it("非 202 回應拋出含狀態碼與 request-id 的錯誤", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      isTokenCall(String(input))
        ? tokenOk()
        : new Response(JSON.stringify({ error: { code: "ErrorAccessDenied" } }), {
            status: 403,
            headers: { "request-id": "req-403" },
          }),
    );
    const mailer = createGraphMailer(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const err = await mailer.sendMail(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphMailError);
    expect((err as GraphMailError).status).toBe(403);
    expect((err as GraphMailError).requestId).toBe("req-403");
    expect((err as GraphMailError).message).toContain("ErrorAccessDenied");
  });
});
