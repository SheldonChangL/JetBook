import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  buildImportPlan,
  inferImageMime,
  normalizeEntryPath,
  parseImportZip,
  resolveImageRefPath,
  ZipImportError,
  type ImportTreeNode,
} from "./import-zip";
import { buildMarkdownImport } from "./import-markdown";

/** 以 fflate 打包一份測試 zip（flat keys；bytes 為 Uint8Array）。 */
function makeZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    entries[name] = typeof value === "string" ? strToU8(value) : value;
  }
  return zipSync(entries);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function findChild(nodes: ImportTreeNode[], predicate: (n: ImportTreeNode) => boolean): ImportTreeNode {
  const found = nodes.find(predicate);
  expect(found).toBeDefined();
  return found!;
}

describe("parseImportZip — 解壓與安全防護", () => {
  it("巢狀資料夾 + md + 圖片：解出正規化路徑清單", () => {
    const zip = makeZip({
      "docs/intro.md": "# 介紹\n\n內文。",
      "docs/guide/setup.md": "# 安裝",
      "images/logo.png": PNG,
      "notes.txt": "純文字",
    });
    const files = parseImportZip(zip);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(["docs/guide/setup.md", "docs/intro.md", "images/logo.png", "notes.txt"]);
  });

  it("反斜線路徑正規化為正斜線", () => {
    const zip = makeZip({ "a\\b\\c.md": "# x" });
    const files = parseImportZip(zip);
    expect(files[0]?.path).toBe("a/b/c.md");
  });

  it("略過目錄 entry 與 macOS 雜訊（__MACOSX、.DS_Store）", () => {
    const zip = makeZip({
      "keep.md": "# 保留",
      "__MACOSX/keep.md": "x",
      ".DS_Store": "y",
      "sub/.DS_Store": "z",
    });
    const files = parseImportZip(zip);
    expect(files.map((f) => f.path)).toEqual(["keep.md"]);
  });

  it("路徑穿越（..）被拒：PATH_TRAVERSAL", () => {
    const zip = makeZip({ "../evil.md": "boom" });
    expect(() => parseImportZip(zip)).toThrowError(ZipImportError);
    try {
      parseImportZip(zip);
    } catch (error) {
      expect((error as ZipImportError).code).toBe("PATH_TRAVERSAL");
    }
  });

  it("巢狀路徑穿越（a/../../b）被拒", () => {
    const zip = makeZip({ "a/../../b.md": "boom" });
    try {
      parseImportZip(zip);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ZipImportError).code).toBe("PATH_TRAVERSAL");
    }
  });

  it("entry 數超過上限：TOO_MANY_ENTRIES", () => {
    const zip = makeZip({ "a.md": "1", "b.md": "2", "c.md": "3" });
    try {
      parseImportZip(zip, { maxEntries: 2, maxSingleFileBytes: 1000, maxTotalBytes: 1000 });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ZipImportError).code).toBe("TOO_MANY_ENTRIES");
    }
  });

  it("單檔超過上限：FILE_TOO_LARGE", () => {
    const zip = makeZip({ "big.md": "0123456789ABCDEF" });
    try {
      parseImportZip(zip, { maxEntries: 500, maxSingleFileBytes: 8, maxTotalBytes: 1000 });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ZipImportError).code).toBe("FILE_TOO_LARGE");
    }
  });

  it("解壓總量超過上限：TOTAL_TOO_LARGE", () => {
    const zip = makeZip({ "a.md": "0123456789", "b.md": "0123456789" });
    try {
      parseImportZip(zip, { maxEntries: 500, maxSingleFileBytes: 1000, maxTotalBytes: 15 });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ZipImportError).code).toBe("TOTAL_TOO_LARGE");
    }
  });

  it("無可匯入檔案：EMPTY_ARCHIVE", () => {
    const zip = makeZip({ "__MACOSX/x": "a", ".DS_Store": "b" });
    try {
      parseImportZip(zip);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ZipImportError).code).toBe("EMPTY_ARCHIVE");
    }
  });

  it("非 zip 位元組：INVALID_ZIP", () => {
    try {
      parseImportZip(new Uint8Array([1, 2, 3, 4, 5]));
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ZipImportError).code).toBe("INVALID_ZIP");
    }
  });
});

describe("normalizeEntryPath", () => {
  it("折疊前導斜線與 ./ 段", () => {
    expect(normalizeEntryPath("/a/./b/c.md")).toBe("a/b/c.md");
  });
  it("NUL 位元組被拒", () => {
    expect(() => normalizeEntryPath("a\0b")).toThrowError(ZipImportError);
  });
  it("磁碟機代號（C:）被拒", () => {
    expect(() => normalizeEntryPath("C:/x.md")).toThrowError(ZipImportError);
  });
});

describe("buildImportPlan — 資料夾→頁面樹", () => {
  it("資料夾成為父頁、.md 成為子頁、圖片收集、其他略過", () => {
    const files = parseImportZip(
      makeZip({
        "docs/intro.md": "# 介紹\n\n內文。",
        "docs/guide/setup.md": "# 安裝",
        "images/logo.png": PNG,
        "readme.md": "# 讀我",
        "notes.txt": "純文字",
      }),
    );
    const plan = buildImportPlan(files);

    // roots：資料夾 docs 與根層頁面 readme（依路徑序）
    expect(plan.tree.map((n) => `${n.kind}:${n.path}`).sort()).toEqual(["folder:docs", "page:readme.md"]);

    const docs = findChild(plan.tree, (n) => n.path === "docs");
    expect(docs.kind).toBe("folder");
    const intro = findChild(docs.children, (n) => n.path === "docs/intro.md");
    expect(intro.kind).toBe("page");
    expect(intro.markdown).toContain("# 介紹");
    const guide = findChild(docs.children, (n) => n.path === "docs/guide");
    expect(guide.kind).toBe("folder");
    const setup = findChild(guide.children, (n) => n.path === "docs/guide/setup.md");
    expect(setup.kind).toBe("page");

    // 圖片（不建成資料夾頁）
    expect(plan.images.map((i) => i.path)).toEqual(["images/logo.png"]);
    // 略過
    expect(plan.skipped).toEqual([{ path: "notes.txt", reason: "unsupported-type" }]);
    // pageCount＝資料夾(2) + 頁面(3)
    expect(plan.pageCount).toBe(5);
  });

  it("只含圖片的資料夾不會變成空頁", () => {
    const files = parseImportZip(makeZip({ "assets/a.png": PNG, "assets/b.png": PNG, "top.md": "# 頂層" }));
    const plan = buildImportPlan(files);
    expect(plan.tree.map((n) => n.path)).toEqual(["top.md"]);
    expect(plan.images).toHaveLength(2);
    expect(plan.pageCount).toBe(1);
  });
});

describe("resolveImageRefPath — 圖片引用解析", () => {
  it.each([
    ["docs", "../images/logo.png", "images/logo.png"],
    ["docs", "./pic.png", "docs/pic.png"],
    ["docs", "sub/pic.png", "docs/sub/pic.png"],
    ["", "img/a.png", "img/a.png"],
    ["docs", "/images/logo.png", "images/logo.png"],
    ["docs/guide", "../../images/a.png", "images/a.png"],
    ["docs", "pic%20space.png", "docs/pic space.png"],
    ["docs", "pic.png?v=2#frag", "docs/pic.png"],
  ])("baseDir=%s ref=%s → %s", (baseDir, href, expected) => {
    expect(resolveImageRefPath(baseDir, href)).toBe(expected);
  });

  it.each([
    ["docs", "https://x.com/a.png"],
    ["docs", "http://x.com/a.png"],
    ["docs", "data:image/png;base64,AAAA"],
    ["docs", "//cdn.example.com/a.png"],
    ["docs", "../../escape.png"],
  ])("外部或逃出根 → null（baseDir=%s ref=%s）", (baseDir, href) => {
    expect(resolveImageRefPath(baseDir, href)).toBeNull();
  });
});

describe("inferImageMime", () => {
  it.each([
    ["logo.png", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.JPG", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.gif", "image/gif"],
    ["a.webp", "image/webp"],
  ])("%s → %s", (name, mime) => {
    expect(inferImageMime(name)).toBe(mime);
  });
  it.each(["a.txt", "a.svg", "a.pdf", "noext"])("非圖片 %s → null", (name) => {
    expect(inferImageMime(name)).toBeNull();
  });
});

describe("圖片引用改寫（buildImportPlan + buildMarkdownImport 組合）", () => {
  it("md 的相對圖片引用 → block image 節點（src=/api/files/<id>）", () => {
    const files = parseImportZip(
      makeZip({
        "docs/intro.md": "# 介紹\n\n說明文字。\n\n![標誌](../images/logo.png)",
        "images/logo.png": PNG,
      }),
    );
    const plan = buildImportPlan(files);
    const imageIdByPath = new Map(plan.images.map((img) => [img.path, "att-123"]));

    const docs = findChild(plan.tree, (n) => n.path === "docs");
    const intro = findChild(docs.children, (n) => n.path === "docs/intro.md");
    const baseDir = "docs";
    let hits = 0;
    const { title, doc } = buildMarkdownImport(intro.markdown!, intro.fileName!, {
      resolveImageSrc: (href) => {
        const key = resolveImageRefPath(baseDir, href);
        const id = key ? imageIdByPath.get(key) : undefined;
        if (!id) return null;
        hits += 1;
        return `/api/files/${id}`;
      },
    });

    // H1 萃取為標題並自本文移除
    expect(title).toBe("介紹");
    expect(hits).toBe(1);
    const imageNode = (doc.content ?? []).find((n) => n.type === "image");
    expect(imageNode).toEqual({ type: "image", attrs: { src: "/api/files/att-123", alt: "標誌" } });
  });
});
