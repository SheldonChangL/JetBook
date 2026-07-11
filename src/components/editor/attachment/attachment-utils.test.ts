import { describe, expect, it } from "vitest";
import { ALLOWED_FILE_TYPES } from "@/lib/storage/validate";
import {
  attachmentAcceptAttr,
  attachmentFileUrl,
  formatFileSize,
} from "./attachment-utils";

describe("attachmentFileUrl", () => {
  it("組出同源 /api/files/<id> 下載路徑", () => {
    expect(attachmentFileUrl("abc-123")).toBe("/api/files/abc-123");
  });
});

describe("attachmentAcceptAttr", () => {
  it("涵蓋伺服端白名單所有副檔名（單一事實來源）", () => {
    const accept = attachmentAcceptAttr().split(",");
    expect(accept).toEqual(Object.keys(ALLOWED_FILE_TYPES));
    expect(accept).toContain(".pdf");
    expect(accept).toContain(".docx");
  });
});

describe("formatFileSize", () => {
  it("小於 1KB 以 B 表示", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });
  it("KB／MB／GB 進位（至多一位小數）", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1 MB");
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe("2.5 MB");
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1 GB");
  });
  it("非法輸入回空字串", () => {
    expect(formatFileSize(-1)).toBe("");
    expect(formatFileSize(Number.NaN)).toBe("");
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe("");
  });
});
