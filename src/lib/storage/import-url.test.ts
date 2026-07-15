import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  downloadImage,
  nodeHttpTransport,
  pinnedLookup,
  type HostResolver,
  type ImportHttpResponse,
  type ImportTransport,
} from "./import-url";

/**
 * downloadImage 的 SSRF／網路行為單元測試（注入 fake transport + resolver，
 * 免真實網路與 loopback 例外）。orchestrator（權限＋存附件）走整合測試（真 PG）。
 */

const ALLOW = ["images.test", "redmine.test", "cdn.test"];

/** async iterable body from chunks。 */
function bodyOf(...chunks: Buffer[]): AsyncIterable<Buffer> {
  return (async function* gen() {
    for (const c of chunks) yield c;
  })();
}

type FakeRes = { status: number; headers?: Record<string, string>; body?: AsyncIterable<Buffer> };

/** 依序回應（支援 redirect 鏈）；記錄每次請求的 URL。 */
function seqTransport(responses: FakeRes[]): { transport: ImportTransport; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const transport: ImportTransport = async (url) => {
    calls.push(url.href);
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    const res: ImportHttpResponse = {
      status: r.status,
      headers: r.headers ?? {},
      body: r.body ?? bodyOf(),
      discard: () => {},
    };
    return res;
  };
  return { transport, calls };
}

/** hostname → IP 陣列；未列出者回預設公開 IP。 */
function resolverOf(map: Record<string, string[]>): HostResolver {
  return async (host) => map[host] ?? ["93.184.216.34"];
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(40, 0x11)]);
const opts = (transport: ImportTransport, resolver: HostResolver, maxBytes = 10_000) => ({
  allowlist: ALLOW,
  maxBytes,
  timeoutMs: 100,
  resolver,
  transport,
});

describe("downloadImage 成功路徑", () => {
  it("下載 200 內容並回傳 bytes 與宣告 Content-Type", async () => {
    const { transport } = seqTransport([
      { status: 200, headers: { "content-type": "image/jpeg" }, body: bodyOf(JPEG) },
    ]);
    const r = await downloadImage("https://images.test/a.jpg", opts(transport, resolverOf({})));
    expect(r.buffer.equals(JPEG)).toBe(true);
    expect(r.declaredContentType).toBe("image/jpeg");
    expect(r.finalUrl).toBe("https://images.test/a.jpg");
  });

  it("追蹤 redirect 至另一允許 host", async () => {
    const { transport, calls } = seqTransport([
      { status: 302, headers: { location: "https://cdn.test/b.jpg" } },
      { status: 200, headers: { "content-type": "image/jpeg" }, body: bodyOf(JPEG) },
    ]);
    const r = await downloadImage("https://images.test/a.jpg", opts(transport, resolverOf({})));
    expect(r.buffer.equals(JPEG)).toBe(true);
    expect(calls).toEqual(["https://images.test/a.jpg", "https://cdn.test/b.jpg"]);
  });
});

describe("downloadImage SSRF 防護", () => {
  it("host 不在 allowlist → HOST_NOT_ALLOWED", async () => {
    const { transport } = seqTransport([{ status: 200 }]);
    await expect(
      downloadImage("https://evil.test/a.jpg", opts(transport, resolverOf({}))),
    ).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
  });

  it("非 http/https 協定 → PROTOCOL_NOT_ALLOWED", async () => {
    const { transport } = seqTransport([{ status: 200 }]);
    await expect(
      downloadImage("ftp://images.test/a.jpg", opts(transport, resolverOf({}))),
    ).rejects.toMatchObject({ code: "PROTOCOL_NOT_ALLOWED" });
  });

  it("解析到受封鎖位址（cloud metadata）→ BLOCKED_ADDRESS", async () => {
    const { transport } = seqTransport([{ status: 200, body: bodyOf(JPEG) }]);
    await expect(
      downloadImage(
        "https://images.test/a.jpg",
        opts(transport, resolverOf({ "images.test": ["169.254.169.254"] })),
      ),
    ).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
  });

  it("redirect 目標 host 不在 allowlist → 重驗即拒絕", async () => {
    const { transport } = seqTransport([
      { status: 302, headers: { location: "https://evil.test/x.jpg" } },
    ]);
    await expect(
      downloadImage("https://images.test/a.jpg", opts(transport, resolverOf({}))),
    ).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
  });

  it("redirect 目標解析到受封鎖位址 → BLOCKED_ADDRESS", async () => {
    const { transport } = seqTransport([
      { status: 302, headers: { location: "https://redmine.test/x.jpg" } },
      { status: 200, body: bodyOf(JPEG) },
    ]);
    await expect(
      downloadImage(
        "https://images.test/a.jpg",
        opts(transport, resolverOf({ "images.test": ["1.2.3.4"], "redmine.test": ["127.0.0.1"] })),
      ),
    ).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
  });

  it("redirect 次數超過上限 → TOO_MANY_REDIRECTS", async () => {
    const { transport } = seqTransport([
      { status: 302, headers: { location: "https://images.test/1" } },
      { status: 302, headers: { location: "https://images.test/2" } },
      { status: 302, headers: { location: "https://images.test/3" } },
      { status: 302, headers: { location: "https://images.test/4" } },
      { status: 302, headers: { location: "https://images.test/5" } },
    ]);
    await expect(
      downloadImage("https://images.test/a.jpg", { ...opts(transport, resolverOf({})), maxRedirects: 2 }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  });

  it("DNS 無解析結果 → DNS_FAILED", async () => {
    const { transport } = seqTransport([{ status: 200 }]);
    const emptyResolver: HostResolver = async () => [];
    await expect(
      downloadImage("https://images.test/a.jpg", opts(transport, emptyResolver)),
    ).rejects.toMatchObject({ code: "DNS_FAILED" });
  });
});

describe("downloadImage 大小與狀態", () => {
  it("串流累積超過 maxBytes → FILE_TOO_LARGE", async () => {
    const { transport } = seqTransport([
      { status: 200, body: bodyOf(Buffer.alloc(600, 1), Buffer.alloc(600, 1)) },
    ]);
    await expect(
      downloadImage("https://images.test/a.jpg", opts(transport, resolverOf({}), 1000)),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("Content-Length 宣告超限 → FILE_TOO_LARGE（不下載）", async () => {
    const { transport } = seqTransport([
      { status: 200, headers: { "content-length": "5000" }, body: bodyOf(JPEG) },
    ]);
    await expect(
      downloadImage("https://images.test/a.jpg", opts(transport, resolverOf({}), 1000)),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("非 2xx → HTTP_ERROR", async () => {
    const { transport } = seqTransport([{ status: 404 }]);
    await expect(
      downloadImage("https://images.test/a.jpg", opts(transport, resolverOf({}))),
    ).rejects.toMatchObject({ code: "HTTP_ERROR" });
  });
});

describe("pinnedLookup（Node http/https agent 以 {all:true} 呼叫，回呼須回陣列）", () => {
  it("options.all=true → 回陣列 [{address,family}]（避免 ERR_INVALID_IP_ADDRESS）", () => {
    const lookup = pinnedLookup("10.0.0.5", 4) as unknown as (
      h: string,
      o: unknown,
      cb: (e: unknown, a: unknown, f?: number) => void,
    ) => void;
    let received: unknown;
    lookup("host.test", { all: true }, (_e, addr) => {
      received = addr;
    });
    expect(received).toEqual([{ address: "10.0.0.5", family: 4 }]);
  });

  it("options 無 all（單值形）→ 回 (address, family)", () => {
    const lookup = pinnedLookup("2001:db8::1", 6) as unknown as (
      h: string,
      o: unknown,
      cb: (e: unknown, a: unknown, f?: number) => void,
    ) => void;
    let addr: unknown;
    let fam: unknown;
    lookup("host.test", {}, (_e, a, f) => {
      addr = a;
      fam = f;
    });
    expect(addr).toBe("2001:db8::1");
    expect(fam).toBe(6);
  });
});

describe("nodeHttpTransport（真實 node:http 路徑 + 自訂 pinned lookup）", () => {
  it("以不存在於 DNS 的 hostname 為 URL、pin 到本機伺服器 → 200 並讀回 body", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end("REAL-BODY-BYTES");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;
    try {
      // host "pinned.invalid" 不存在於真實 DNS：能連上即證明自訂 lookup（pin 至 127.0.0.1）生效。
      const res = await nodeHttpTransport(new URL(`http://pinned.invalid:${port}/img.jpg`), {
        pinnedAddress: "127.0.0.1",
        family: 4,
        timeoutMs: 3000,
      });
      expect(res.status).toBe(200);
      const chunks: Buffer[] = [];
      for await (const c of res.body) chunks.push(c);
      expect(Buffer.concat(chunks).toString()).toBe("REAL-BODY-BYTES");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("redirect 回應：狀態與 Location 標頭原樣傳出（供 downloadImage 逐跳重驗）", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { location: "https://elsewhere.test/x.jpg" });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await nodeHttpTransport(new URL(`http://pinned.invalid:${port}/`), {
        pinnedAddress: "127.0.0.1",
        family: 4,
        timeoutMs: 3000,
      });
      expect(res.status).toBe(302);
      expect(res.headers["location"]).toBe("https://elsewhere.test/x.jpg");
      res.discard?.();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
