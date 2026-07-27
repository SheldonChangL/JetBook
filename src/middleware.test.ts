import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

/**
 * middleware 單元測試（issue #273）：重點在「不做需要 DB 才能正確判斷的事」。
 *
 * middleware 跑在 edge、無 DB，只能看到 session cookie 是否存在。若它在「cookie 存在」時
 * 就把 /login 轉回 /，遇上殘留的無效 cookie（admin 重設他人密碼、撤銷 session、資料庫重建）
 * 就會與 requireSession 的 redirect("/login") 互推成無限重導向，使用者無法自救。
 * 因此 /login 一律放行，「已登入者導回首頁」交由 /login 的 RSC 以真實 session 決定。
 */

const SESSION_COOKIE = "jetbook_session";

function request(path: string, cookieValue?: string): NextRequest {
  const headers = new Headers();
  if (cookieValue !== undefined) headers.set("cookie", `${SESSION_COOKIE}=${cookieValue}`);
  return new NextRequest(new URL(`http://jetbook.test${path}`), { headers });
}

/** NextResponse.next() 沒有 location header；redirect 才有。 */
function locationOf(response: Response): string | null {
  return response.headers.get("location");
}

describe("未帶 session cookie 的內頁請求（快篩導向登入）", () => {
  it("導向 /login 並帶 returnTo（含 query string）", () => {
    const response = middleware(request("/spaces/handbook?tab=pages"));

    expect(response.status).toBe(307);
    const location = new URL(locationOf(response)!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnTo")).toBe("/spaces/handbook?tab=pages");
  });

  it("public 路徑一律放行，不導向", () => {
    for (const path of ["/login", "/forgot-password", "/reset-password", "/api/healthz"]) {
      const response = middleware(request(path));
      expect(locationOf(response), `${path} 不應被導向`).toBeNull();
    }
  });

  it("Bearer 客戶端路徑（/api/v1、/api/mcp）放行，交由 handler 層驗 token", () => {
    for (const path of ["/api/v1/spaces", "/api/mcp"]) {
      const response = middleware(request(path));
      expect(locationOf(response), `${path} 不應被 307 導 login`).toBeNull();
    }
  });
});

describe("帶 session cookie 時不做 DB 級判斷（issue #273 迴圈修正）", () => {
  it("訪問 /login 一律放行——不得因 cookie 存在就轉回首頁", () => {
    const response = middleware(request("/login", "stale-invalid-token"));

    expect(locationOf(response)).toBeNull();
    expect(response.status).toBe(200);
  });

  it("帶 returnTo 的 /login 同樣放行（無效 cookie 必須看得到登入表單）", () => {
    const response = middleware(request("/login?returnTo=%2F", "stale-invalid-token"));

    expect(locationOf(response)).toBeNull();
  });

  it("訪問內頁放行，交由 server 端 requireSession 驗證（主防線）", () => {
    const response = middleware(request("/", "any-session-token"));

    expect(locationOf(response)).toBeNull();
  });

  it("空字串 cookie 視為未帶，仍快篩導向 /login", () => {
    const response = middleware(request("/", ""));

    expect(response.status).toBe(307);
    expect(new URL(locationOf(response)!).pathname).toBe("/login");
  });
});

describe("x-request-id 注入", () => {
  it("放行的回應帶 x-request-id", () => {
    const response = middleware(request("/login"));

    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("導向的回應也帶 x-request-id", () => {
    const response = middleware(request("/"));

    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("沿用呼叫端既有的 x-request-id（供跨服務關聯）", () => {
    const headers = new Headers({ "x-request-id": "upstream-request-id" });
    const response = middleware(
      new NextRequest(new URL("http://jetbook.test/login"), { headers }),
    );

    expect(response.headers.get("x-request-id")).toBe("upstream-request-id");
  });
});
