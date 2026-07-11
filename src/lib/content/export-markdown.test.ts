import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  assetZipPath,
  buildExportForest,
  collectAttachmentIds,
  layoutExport,
  pageFileMarkdown,
  relativeAssetPath,
  rewriteAttachmentLinks,
  sanitizeSegment,
  type ExportPage,
} from "./export-markdown";
import { buildImportPlan, parseImportZip, type ImportTreeNode } from "./import-zip";
import { buildMarkdownImport } from "./import-markdown";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("sanitizeSegment", () => {
  it("移除路徑分隔與 Windows 保留字元", () => {
    expect(sanitizeSegment('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });
  it("移除控制字元、折疊空白、去前後點", () => {
    expect(sanitizeSegment("  ..hello\tworld..  ")).toBe("hello world");
  });
  it("保留中文、連字號與空白", () => {
    expect(sanitizeSegment("入門-指南 v1")).toBe("入門-指南 v1");
  });
  it("全非法字元 → 保留底線（呼叫端另以 untitled 保底）", () => {
    expect(sanitizeSegment("///")).toBe("___");
    expect(sanitizeSegment("   ")).toBe("");
  });
});

describe("buildExportForest", () => {
  const pages: ExportPage[] = [
    { id: "p1", parentId: null, title: "A", contentMd: "" },
    { id: "p2", parentId: "p1", title: "A-1", contentMd: "" },
    { id: "p3", parentId: null, title: "B", contentMd: "" },
    { id: "p4", parentId: "missing", title: "孤兒", contentMd: "" },
  ];

  it("依 parentId 組樹；parentId 指向不存在頁者視為根層", () => {
    const forest = buildExportForest(pages);
    const titles = forest.map((n) => n.page.title);
    expect(titles).toEqual(["A", "B", "孤兒"]);
    expect(forest[0]!.children.map((c) => c.page.title)).toEqual(["A-1"]);
    expect(forest[1]!.children).toEqual([]);
  });
});

describe("layoutExport", () => {
  it("葉頁 → <名>.md；有子頁 → <名>/README.md 且子頁置於資料夾內", () => {
    const forest = buildExportForest([
      { id: "p1", parentId: null, title: "指南", contentMd: "" },
      { id: "p2", parentId: "p1", title: "安裝", contentMd: "" },
      { id: "p3", parentId: null, title: "總覽", contentMd: "" },
    ]);
    const entries = layoutExport(forest);
    const byId = new Map(entries.map((e) => [e.page.id, e]));
    expect(byId.get("p1")!.path).toBe("指南/README.md");
    expect(byId.get("p1")!.isFolder).toBe(true);
    expect(byId.get("p2")!.path).toBe("指南/安裝.md");
    expect(byId.get("p2")!.dir).toBe("指南");
    expect(byId.get("p3")!.path).toBe("總覽.md");
    expect(byId.get("p3")!.dir).toBe("");
  });

  it("同層撞名 → 附 -2、-3 後綴（不分大小寫）", () => {
    const forest = buildExportForest([
      { id: "a", parentId: null, title: "Foo", contentMd: "" },
      { id: "b", parentId: null, title: "foo", contentMd: "" },
      { id: "c", parentId: null, title: "FOO", contentMd: "" },
    ]);
    const paths = layoutExport(forest).map((e) => e.path);
    expect(paths).toEqual(["Foo.md", "foo-2.md", "FOO-3.md"]);
  });

  it("根層保留 assets 名，避免與附件目錄相撞", () => {
    const forest = buildExportForest([{ id: "a", parentId: null, title: "assets", contentMd: "" }]);
    expect(layoutExport(forest)[0]!.path).toBe("assets-2.md");
  });

  it("資料夾內子頁名為 README/index 時避開自身內容檔", () => {
    const forest = buildExportForest([
      { id: "p1", parentId: null, title: "節", contentMd: "" },
      { id: "p2", parentId: "p1", title: "README", contentMd: "" },
      { id: "p3", parentId: "p1", title: "index", contentMd: "" },
    ]);
    const entries = layoutExport(forest);
    const byId = new Map(entries.map((e) => [e.page.id, e]));
    expect(byId.get("p1")!.path).toBe("節/README.md");
    expect(byId.get("p2")!.path).toBe("節/README-2.md");
    expect(byId.get("p3")!.path).toBe("節/index-2.md");
  });
});

describe("附件連結收集與改寫", () => {
  it("collectAttachmentIds 去重、小寫", () => {
    const md = `![a](/api/files/${UUID_A}) [b](/api/files/${UUID_B}) again(/api/files/${UUID_A})`;
    expect(collectAttachmentIds(md).sort()).toEqual([UUID_A, UUID_B].sort());
  });

  it("rewriteAttachmentLinks：resolve 回相對路徑則改寫；回 null 維持原樣", () => {
    const md = `![x](/api/files/${UUID_A}) 與 [y](/api/files/${UUID_B})`;
    const out = rewriteAttachmentLinks(md, (id) => (id === UUID_A ? "assets/x.png" : null));
    expect(out).toBe(`![x](assets/x.png) 與 [y](/api/files/${UUID_B})`);
  });

  it("assetZipPath / relativeAssetPath", () => {
    expect(assetZipPath(UUID_A, "圖.PNG")).toBe(`assets/${UUID_A}.png`);
    expect(relativeAssetPath("", "assets/x.png")).toBe("assets/x.png");
    expect(relativeAssetPath("A", "assets/x.png")).toBe("../assets/x.png");
    expect(relativeAssetPath("A/B", "assets/x.png")).toBe("../../assets/x.png");
  });
});

describe("pageFileMarkdown", () => {
  it("標題化為 H1，其後接 content_md", () => {
    expect(pageFileMarkdown("標題", "內文")).toBe("# 標題\n\n內文\n");
  });
  it("content_md 為空時只留 H1", () => {
    expect(pageFileMarkdown("標題", "")).toBe("# 標題\n");
  });
  it("標題為空時省略 H1", () => {
    expect(pageFileMarkdown("", "內文")).toBe("內文\n");
  });
});

// 純 round-trip（不觸 DB）：export 佈局 → zip → 匯入解析層還原標題與樹結構（F-IE-02）。
describe("round-trip（純規劃層 ↔ 匯入解析層）", () => {
  interface SimpleNode {
    title: string;
    children: SimpleNode[];
  }

  /** 以匯入端邏輯還原每個節點的頁面標題（資料夾帶 README/index 內容者由 H1 覆寫）。 */
  function reconstruct(nodes: ImportTreeNode[]): SimpleNode[] {
    return nodes.map((node) => {
      let title = node.title;
      if (node.markdown !== undefined) {
        title = buildMarkdownImport(node.markdown, node.fileName ?? node.path).title;
      }
      return { title, children: reconstruct(node.children) };
    });
  }

  it("內容＋子頁的頁面往返後標題與階層保留", () => {
    const forest = buildExportForest([
      { id: "p1", parentId: null, title: "指南", contentMd: "歡迎使用" },
      { id: "p2", parentId: "p1", title: "安裝", contentMd: "步驟一" },
      { id: "p3", parentId: "p2", title: "進階", contentMd: "細節" },
      { id: "p4", parentId: null, title: "總覽", contentMd: "概述" },
    ]);
    const entries = layoutExport(forest);

    const zipInput: Record<string, Uint8Array> = {};
    for (const entry of entries) {
      zipInput[entry.path] = strToU8(pageFileMarkdown(entry.page.title, entry.page.contentMd));
    }
    const zip = zipSync(zipInput);

    const plan = buildImportPlan(parseImportZip(zip));
    const rebuilt = reconstruct(plan.tree);

    expect(rebuilt).toEqual([
      {
        title: "指南",
        children: [{ title: "安裝", children: [{ title: "進階", children: [] }] }],
      },
      { title: "總覽", children: [] },
    ]);

    // 資料夾頁「指南」自身內容經 README 往返（H1 已移除，本文保留）。
    const guide = plan.tree.find((n) => n.path === "指南");
    expect(guide?.markdown).toBeDefined();
    expect(buildMarkdownImport(guide!.markdown!, "README.md").doc.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "歡迎使用" }] },
    ]);
  });
});
