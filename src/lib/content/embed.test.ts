import { describe, expect, it } from "vitest";
import {
  isEmbedUrlAllowed,
  normalizeEmbedUrl,
  parseEmbedDomains,
  parseHttpUrl,
} from "./embed";

describe("parseEmbedDomains", () => {
  it("解析逗號分隔並正規化（小寫/去空白/去 scheme/去路徑/去 www.）", () => {
    expect(
      parseEmbedDomains(" YouTube.com , https://www.figma.com/file , vimeo.com "),
    ).toEqual(["youtube.com", "figma.com", "vimeo.com"]);
  });

  it("空或 undefined 回空陣列", () => {
    expect(parseEmbedDomains(undefined)).toEqual([]);
    expect(parseEmbedDomains("")).toEqual([]);
    expect(parseEmbedDomains("  ,  , ")).toEqual([]);
  });
});

describe("normalizeEmbedUrl", () => {
  it("去頭尾空白；非字串回空字串", () => {
    expect(normalizeEmbedUrl("  https://youtube.com/watch?v=x  ")).toBe(
      "https://youtube.com/watch?v=x",
    );
    expect(normalizeEmbedUrl(null)).toBe("");
    expect(normalizeEmbedUrl(123)).toBe("");
  });
});

describe("parseHttpUrl", () => {
  it("接受 http/https", () => {
    expect(parseHttpUrl("https://example.com/a")?.href).toBe("https://example.com/a");
    expect(parseHttpUrl("http://example.com")?.href).toBe("http://example.com/");
  });

  it("拒絕非 http(s) scheme 與非法字串（防注入）", () => {
    expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(parseHttpUrl("file:///etc/passwd")).toBeNull();
    expect(parseHttpUrl("not a url")).toBeNull();
    expect(parseHttpUrl("")).toBeNull();
  });
});

describe("isEmbedUrlAllowed", () => {
  const allow = parseEmbedDomains("youtube.com, youtu.be, figma.com, vimeo.com");

  it("完全相符與子網域相符", () => {
    expect(isEmbedUrlAllowed("https://youtube.com/watch?v=x", allow)).toBe(true);
    expect(isEmbedUrlAllowed("https://www.youtube.com/watch?v=x", allow)).toBe(true);
    expect(isEmbedUrlAllowed("https://www.youtube-nocookie.com", allow)).toBe(false);
    expect(isEmbedUrlAllowed("https://player.vimeo.com/video/123", allow)).toBe(true);
    expect(isEmbedUrlAllowed("https://www.figma.com/file/abc", allow)).toBe(true);
    expect(isEmbedUrlAllowed("https://youtu.be/abc", allow)).toBe(true);
  });

  it("防子網域偽冒（dot-suffix 邊界）", () => {
    expect(isEmbedUrlAllowed("https://evil-youtube.com", allow)).toBe(false);
    expect(isEmbedUrlAllowed("https://youtube.com.evil.com/x", allow)).toBe(false);
    expect(isEmbedUrlAllowed("https://notyoutube.com", allow)).toBe(false);
  });

  it("名單外網域不允許", () => {
    expect(isEmbedUrlAllowed("https://example.com", allow)).toBe(false);
    expect(isEmbedUrlAllowed("https://malicious.test/video", allow)).toBe(false);
  });

  it("非 http(s) 一律不允許（即使網域相符）", () => {
    expect(isEmbedUrlAllowed("javascript:youtube.com", allow)).toBe(false);
    expect(isEmbedUrlAllowed("ftp://youtube.com", allow)).toBe(false);
  });

  it("空白名單一律不允許", () => {
    expect(isEmbedUrlAllowed("https://youtube.com", [])).toBe(false);
  });
});
