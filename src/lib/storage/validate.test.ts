import { describe, expect, it } from "vitest";
import { fileExtension, validateUpload } from "./validate";

const MB = 1024 * 1024;
const base = { sizeBytes: 1024, maxBytes: 50 * MB };

describe("fileExtension", () => {
  it("取小寫副檔名（含點）", () => {
    expect(fileExtension("Photo.JPG")).toBe(".jpg");
    expect(fileExtension("report.v2.pdf")).toBe(".pdf");
  });

  it("無副檔名或隱藏檔回空字串", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".gitignore")).toBe("");
  });
});

describe("validateUpload 雙白名單", () => {
  it("白名單內且副檔名與 MIME 對應 → 通過", () => {
    expect(validateUpload({ ...base, fileName: "a.png", mimeType: "image/png" })).toBeNull();
    expect(validateUpload({ ...base, fileName: "b.PDF", mimeType: "application/pdf" })).toBeNull();
    expect(
      validateUpload({
        ...base,
        fileName: "c.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBeNull();
    expect(validateUpload({ ...base, fileName: "d.zip", mimeType: "application/zip" })).toBeNull();
  });

  it("名單外副檔名 → INVALID_FILE_TYPE（含可執行/腳本）", () => {
    for (const name of ["evil.exe", "run.sh", "page.html", "vector.svg", "noext"]) {
      expect(validateUpload({ ...base, fileName: name, mimeType: "application/pdf" })).toBe(
        "INVALID_FILE_TYPE",
      );
    }
  });

  it("副檔名與 MIME 不對應 → INVALID_FILE_TYPE", () => {
    expect(validateUpload({ ...base, fileName: "a.png", mimeType: "application/pdf" })).toBe(
      "INVALID_FILE_TYPE",
    );
    expect(validateUpload({ ...base, fileName: "a.pdf", mimeType: "text/html" })).toBe(
      "INVALID_FILE_TYPE",
    );
  });

  it("超過上限 → FILE_TOO_LARGE；剛好等於上限 → 通過", () => {
    expect(
      validateUpload({ fileName: "a.png", mimeType: "image/png", sizeBytes: 50 * MB + 1, maxBytes: 50 * MB }),
    ).toBe("FILE_TOO_LARGE");
    expect(
      validateUpload({ fileName: "a.png", mimeType: "image/png", sizeBytes: 50 * MB, maxBytes: 50 * MB }),
    ).toBeNull();
  });

  it("空檔案 → FILE_EMPTY", () => {
    expect(validateUpload({ ...base, sizeBytes: 0, fileName: "a.png", mimeType: "image/png" })).toBe(
      "FILE_EMPTY",
    );
  });
});
