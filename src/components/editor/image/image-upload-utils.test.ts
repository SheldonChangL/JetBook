import { describe, expect, it } from "vitest";
import {
  getImageFiles,
  imageFileUrl,
  isImageFile,
  isRetryableUploadError,
  normalizeUploadErrorCode,
  uploadErrorMessageKey,
  type UploadErrorCode,
} from "./image-upload-utils";

describe("isImageFile", () => {
  it("接受白名單圖片 MIME（大小寫不敏感）", () => {
    expect(isImageFile({ type: "image/png" })).toBe(true);
    expect(isImageFile({ type: "image/JPEG" })).toBe(true);
    expect(isImageFile({ type: "image/gif" })).toBe(true);
    expect(isImageFile({ type: "image/webp" })).toBe(true);
  });
  it("拒絕非圖片與 SVG（XSS 面）與空型別", () => {
    expect(isImageFile({ type: "application/pdf" })).toBe(false);
    expect(isImageFile({ type: "image/svg+xml" })).toBe(false);
    expect(isImageFile({ type: "" })).toBe(false);
  });
});

describe("imageFileUrl", () => {
  it("由附件 id 組出同源下載路徑", () => {
    expect(imageFileUrl("abc-123")).toBe("/api/files/abc-123");
  });
});

describe("getImageFiles", () => {
  it("null/undefined 回空陣列", () => {
    expect(getImageFiles(null)).toEqual([]);
    expect(getImageFiles(undefined)).toEqual([]);
  });
  it("只保留圖片檔，濾除其他型別", () => {
    const png = { type: "image/png", name: "a.png" };
    const pdf = { type: "application/pdf", name: "b.pdf" };
    const fakeList = {
      0: png,
      1: pdf,
      length: 2,
      item: (i: number) => [png, pdf][i],
      [Symbol.iterator]: undefined,
    } as unknown as FileList;
    const result = getImageFiles(fakeList);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(png);
  });
});

describe("normalizeUploadErrorCode", () => {
  it("body error.code 優先於 status", () => {
    expect(normalizeUploadErrorCode(500, "FILE_TOO_LARGE")).toBe("FILE_TOO_LARGE");
    expect(normalizeUploadErrorCode(200, "INVALID_FILE_TYPE")).toBe("INVALID_FILE_TYPE");
    expect(normalizeUploadErrorCode(200, "FORBIDDEN")).toBe("FORBIDDEN");
    expect(normalizeUploadErrorCode(200, "UNAUTHORIZED")).toBe("UNAUTHORIZED");
  });
  it("無法辨識 body code 時退回 status 對應", () => {
    expect(normalizeUploadErrorCode(413, undefined)).toBe("FILE_TOO_LARGE");
    expect(normalizeUploadErrorCode(415, null)).toBe("INVALID_FILE_TYPE");
    expect(normalizeUploadErrorCode(403, "??")).toBe("FORBIDDEN");
    expect(normalizeUploadErrorCode(401, {})).toBe("UNAUTHORIZED");
    expect(normalizeUploadErrorCode(500, undefined)).toBe("UPLOAD_FAILED");
  });
});

describe("uploadErrorMessageKey / isRetryableUploadError", () => {
  it("錯誤碼對應 i18n key 後綴", () => {
    const map: Record<UploadErrorCode, string> = {
      FILE_TOO_LARGE: "errorTooLarge",
      INVALID_FILE_TYPE: "errorType",
      FORBIDDEN: "errorForbidden",
      UNAUTHORIZED: "errorForbidden",
      UPLOAD_FAILED: "uploadError",
    };
    for (const [code, key] of Object.entries(map)) {
      expect(uploadErrorMessageKey(code as UploadErrorCode)).toBe(key);
    }
  });
  it("只有暫時性失敗（UPLOAD_FAILED）才可重試", () => {
    expect(isRetryableUploadError("UPLOAD_FAILED")).toBe(true);
    expect(isRetryableUploadError("FILE_TOO_LARGE")).toBe(false);
    expect(isRetryableUploadError("INVALID_FILE_TYPE")).toBe(false);
    expect(isRetryableUploadError("FORBIDDEN")).toBe(false);
    expect(isRetryableUploadError("UNAUTHORIZED")).toBe(false);
  });
});
