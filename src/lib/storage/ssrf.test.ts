import { describe, expect, it } from "vitest";
import {
  AttachmentImportError,
  assertUrlAllowed,
  isForbiddenIp,
  isHostAllowed,
  parseImportHosts,
  resolveRedirectTarget,
} from "./ssrf";

describe("isForbiddenIp（硬性封鎖範圍）", () => {
  it("封鎖 loopback", () => {
    expect(isForbiddenIp("127.0.0.1")).toBe(true);
    expect(isForbiddenIp("127.10.20.30")).toBe(true);
    expect(isForbiddenIp("::1")).toBe(true);
  });

  it("封鎖 link-local（含 cloud metadata 169.254.169.254）", () => {
    expect(isForbiddenIp("169.254.169.254")).toBe(true);
    expect(isForbiddenIp("169.254.0.1")).toBe(true);
    expect(isForbiddenIp("fe80::1")).toBe(true);
  });

  it("封鎖 multicast 與未指定／保留／broadcast", () => {
    expect(isForbiddenIp("224.0.0.1")).toBe(true);
    expect(isForbiddenIp("239.255.255.250")).toBe(true);
    expect(isForbiddenIp("ff02::1")).toBe(true);
    expect(isForbiddenIp("0.0.0.0")).toBe(true);
    expect(isForbiddenIp("255.255.255.255")).toBe(true);
    expect(isForbiddenIp("::")).toBe(true);
  });

  it("封鎖 IPv4-mapped IPv6 形式的內部位址（防繞過）", () => {
    expect(isForbiddenIp("::ffff:127.0.0.1")).toBe(true);
    expect(isForbiddenIp("::ffff:169.254.169.254")).toBe(true);
  });

  it("::ffff: 壓縮 hex 形（非點分）一律 fail-closed", () => {
    expect(isForbiddenIp("::ffff:7f00:1")).toBe(true); // = 127.0.0.1 的 hex 形
    expect(isForbiddenIp("::ffff:a9fe:a9fe")).toBe(true); // = 169.254.169.254 的 hex 形
  });

  it("非法輸入 fail-closed（視為封鎖）", () => {
    expect(isForbiddenIp("not-an-ip")).toBe(true);
    expect(isForbiddenIp("")).toBe(true);
    expect(isForbiddenIp("999.999.999.999")).toBe(true);
  });

  it("私有網段不屬硬封鎖（由 host allowlist 授權後可達內網）", () => {
    expect(isForbiddenIp("10.1.2.3")).toBe(false);
    expect(isForbiddenIp("172.16.5.5")).toBe(false);
    expect(isForbiddenIp("192.168.1.10")).toBe(false);
  });

  it("公開位址不封鎖", () => {
    expect(isForbiddenIp("8.8.8.8")).toBe(false);
    expect(isForbiddenIp("1.1.1.1")).toBe(false);
    expect(isForbiddenIp("2001:4860:4860::8888")).toBe(false);
  });
});

describe("parseImportHosts / isHostAllowed", () => {
  it("解析逗號清單並正規化（小寫、去空白、去尾點、去 port）", () => {
    expect(parseImportHosts("redmine.jet-opto.com.tw, IMG.Example.com. ")).toEqual([
      "redmine.jet-opto.com.tw",
      "img.example.com",
    ]);
    expect(parseImportHosts("host.test:8080")).toEqual(["host.test"]);
  });

  it("未設定或空字串 → 空白名單（預設拒絕）", () => {
    expect(parseImportHosts(undefined)).toEqual([]);
    expect(parseImportHosts("")).toEqual([]);
    expect(parseImportHosts("   ,  ")).toEqual([]);
  });

  it("精確比對，不做子網域展開", () => {
    const list = parseImportHosts("redmine.jet-opto.com.tw");
    expect(isHostAllowed("redmine.jet-opto.com.tw", list)).toBe(true);
    expect(isHostAllowed("REDMINE.jet-opto.com.tw", list)).toBe(true);
    expect(isHostAllowed("evil.redmine.jet-opto.com.tw", list)).toBe(false);
    expect(isHostAllowed("jet-opto.com.tw", list)).toBe(false);
  });
});

describe("assertUrlAllowed", () => {
  const allow = parseImportHosts("redmine.jet-opto.com.tw");

  it("允許 http/https 且 host 在名單內", () => {
    expect(() => assertUrlAllowed(new URL("https://redmine.jet-opto.com.tw/a.jpg"), allow)).not.toThrow();
    expect(() => assertUrlAllowed(new URL("http://redmine.jet-opto.com.tw/a.jpg"), allow)).not.toThrow();
  });

  it("非 http/https 協定拒絕", () => {
    expect(() => assertUrlAllowed(new URL("ftp://redmine.jet-opto.com.tw/a"), allow)).toThrow(
      AttachmentImportError,
    );
    expect(() => assertUrlAllowed(new URL("file:///etc/passwd"), allow)).toThrow(AttachmentImportError);
  });

  it("host 不在名單內拒絕（含空名單一律拒絕）", () => {
    expect(() => assertUrlAllowed(new URL("https://evil.example.com/a.jpg"), allow)).toThrow(
      /HOST_NOT_ALLOWED|允許清單/,
    );
    expect(() => assertUrlAllowed(new URL("https://redmine.jet-opto.com.tw/a"), [])).toThrow(
      AttachmentImportError,
    );
  });
});

describe("resolveRedirectTarget", () => {
  it("解析絕對與相對 Location", () => {
    const cur = new URL("https://redmine.jet-opto.com.tw/redmine/attachments/download/1/a.jpg");
    expect(resolveRedirectTarget(cur, "https://cdn.example.com/x.jpg")?.href).toBe(
      "https://cdn.example.com/x.jpg",
    );
    expect(resolveRedirectTarget(cur, "/other/y.jpg")?.href).toBe(
      "https://redmine.jet-opto.com.tw/other/y.jpg",
    );
  });

  it("無法解析回 null", () => {
    expect(resolveRedirectTarget(new URL("https://a.test/"), "http://")).toBeNull();
  });
});
