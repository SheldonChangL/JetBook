import { describe, expect, it } from "vitest";
import { isAllowedImageMime, normalizeImportFilename, sniffImage } from "./image-sniff";

/** 各格式的最小 magic-byte 樣本。 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const GIF = Buffer.from([...Buffer.from("GIF89a"), 0x01]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP"),
  Buffer.from([0x00]),
]);

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const US = String.fromCharCode(0x1f);

describe("sniffImage（以 magic bytes 判真實格式）", () => {
  it("辨識 JPEG／PNG／GIF／WebP", () => {
    expect(sniffImage(JPEG)).toEqual({ mime: "image/jpeg", ext: ".jpg" });
    expect(sniffImage(PNG)).toEqual({ mime: "image/png", ext: ".png" });
    expect(sniffImage(GIF)).toEqual({ mime: "image/gif", ext: ".gif" });
    expect(sniffImage(WEBP)).toEqual({ mime: "image/webp", ext: ".webp" });
  });

  it("拒絕 HTML／SVG／純文字／空檔（回 null）", () => {
    expect(sniffImage(Buffer.from("<!DOCTYPE html><html></html>"))).toBeNull();
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from("just text"))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });

  it("RIFF 但非 WEBP（如 WAV）回 null", () => {
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE")]);
    expect(sniffImage(wav)).toBeNull();
  });
});

describe("isAllowedImageMime", () => {
  it("允許四種圖片 MIME（含 charset 參數）", () => {
    expect(isAllowedImageMime("image/jpeg")).toBe(true);
    expect(isAllowedImageMime("image/png; charset=binary")).toBe(true);
    expect(isAllowedImageMime("IMAGE/WEBP")).toBe(true);
  });
  it("拒絕非圖片與空值", () => {
    expect(isAllowedImageMime("text/html")).toBe(false);
    expect(isAllowedImageMime("image/svg+xml")).toBe(false);
    expect(isAllowedImageMime(undefined)).toBe(false);
    expect(isAllowedImageMime(null)).toBe(false);
  });
});

describe("normalizeImportFilename（防路徑穿越、副檔名對齊真實格式）", () => {
  it("保留合法檔名與空白、Unicode，補正 canonical 副檔名", () => {
    expect(normalizeImportFilename("Screenshot 2024-02-16 172806.jpg", ".jpg")).toBe(
      "Screenshot 2024-02-16 172806.jpg",
    );
    expect(normalizeImportFilename("截圖.png", ".png")).toBe("截圖.png");
    expect(normalizeImportFilename("a b.jpg", ".jpg")).toBe("a b.jpg"); // 一般空白保留
  });

  it("剝除目錄段與磁碟機路徑（path traversal）", () => {
    expect(normalizeImportFilename("../../etc/passwd", ".png")).toBe("passwd.png");
    expect(normalizeImportFilename("/var/www/a.jpg", ".jpg")).toBe("a.jpg");
    expect(normalizeImportFilename("..\\..\\windows\\b.gif", ".gif")).toBe("b.gif");
  });

  it("副檔名一律對齊真實格式（宣告與內容不符時以真實為準）", () => {
    // 內容是 PNG，但檔名副檔名是 .php → 一律改為 .png
    expect(normalizeImportFilename("evil.php", ".png")).toBe("evil.png");
    expect(normalizeImportFilename("photo.jpeg", ".jpg")).toBe("photo.jpg");
  });

  it("去除控制字元（保留空白）與前導點；空／全點退回 image", () => {
    expect(normalizeImportFilename(`a${NUL}b${US}.jpg`, ".jpg")).toBe("ab.jpg");
    expect(normalizeImportFilename(`x${BEL}y.png`, ".png")).toBe("xy.png");
    expect(normalizeImportFilename("...", ".png")).toBe("image.png");
    expect(normalizeImportFilename("", ".webp")).toBe("image.webp");
    expect(normalizeImportFilename(undefined, ".gif")).toBe("image.gif");
  });
});
