import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { docxToMarkdown, DOCX_IMAGE_SCHEME, imageFileName } from "./import-docx";
import { buildMarkdownImport } from "./import-markdown";

/**
 * M4-08 docx 轉換單元測試：以 fflate 合成最小 WordprocessingML 文件，
 * 驗證 F-IE-03 驗收 1（標題層級/清單/表格/圖片保留）與圖片佔位管線。
 */

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function para(style: string | null, runs: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}${runs}</w:p>`;
}

function run(text: string, bold = false): string {
  const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function listItem(text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(text)}</w:p>`;
}

const IMAGE_XML = `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="pic1" descr="測試圖"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="pic1" descr="測試圖"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId10"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const TABLE_XML = `<w:tbl><w:tr><w:tc><w:p>${run("欄A")}</w:p></w:tc><w:tc><w:p>${run("欄B")}</w:p></w:tc></w:tr><w:tr><w:tc><w:p>${run("值1")}</w:p></w:tc><w:tc><w:p>${run("值2")}</w:p></w:tc></w:tr></w:tbl>`;

function buildDocx(): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>
${para("Heading1", run("文件標題"))}
${para("Heading2", run("第一章"))}
${para(null, `${run("這是")}${run("粗體", true)}${run("與")}<w:hyperlink r:id="rId20">${run("連結")}</w:hyperlink>`)}
${listItem("項目一")}
${listItem("項目二")}
${TABLE_XML}
${IMAGE_XML}
</w:body>
</w:document>`;

  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
<Relationship Id="rId20" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/spec" TargetMode="External"/>
<Relationship Id="rId30" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

  const zipped = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "word/document.xml": strToU8(documentXml),
    "word/numbering.xml": strToU8(numberingXml),
    "word/_rels/document.xml.rels": strToU8(docRels),
    "word/media/image1.png": new Uint8Array(PNG_1PX),
  });
  return Buffer.from(zipped);
}

describe("docxToMarkdown（M4-08，issue #199）", () => {
  it("保留標題層級/粗體/連結/清單/表格，圖片以佔位收集（F-IE-03 驗收 1）", async () => {
    const { markdown, images } = await docxToMarkdown(buildDocx());

    expect(markdown).toContain("# 文件標題");
    expect(markdown).toContain("## 第一章");
    expect(markdown).toContain("**粗體**");
    expect(markdown).toContain("[連結](https://example.com/spec)");
    expect(markdown).toMatch(/-\s+項目一/);
    expect(markdown).toMatch(/-\s+項目二/);
    // GFM 表格
    expect(markdown).toContain("| 欄A | 欄B |");
    expect(markdown).toContain("| 值1 | 值2 |");
    // 圖片：佔位引用＋bytes 收集
    expect(markdown).toContain(`${DOCX_IMAGE_SCHEME}0`);
    expect(images).toHaveLength(1);
    expect(images[0]?.contentType).toBe("image/png");
    expect(Buffer.compare(images[0]!.data, PNG_1PX)).toBe(0);
  });

  it("與 markdown-to-doc 銜接：resolver 改寫圖片為附件 src，doc 含各區塊節點", async () => {
    const { markdown } = await docxToMarkdown(buildDocx());
    const { title, doc } = buildMarkdownImport(markdown, "測試.docx", {
      resolveImageSrc: (href) =>
        href === `${DOCX_IMAGE_SCHEME}0` ? "/api/files/00000000-0000-4000-8000-000000000000" : null,
    });
    expect(title).toBe("文件標題");
    const types = (doc.content ?? []).map((n) => n.type);
    expect(types).toContain("heading");
    expect(types).toContain("bulletList");
    expect(types).toContain("table");
    expect(types).toContain("image");
    const image = (doc.content ?? []).find((n) => n.type === "image");
    expect(image?.attrs?.src).toBe("/api/files/00000000-0000-4000-8000-000000000000");
  });

  it("損壞檔擲出（呼叫端轉 INVALID_DOCX，不產生半成品）", async () => {
    await expect(docxToMarkdown(Buffer.from("not a docx"))).rejects.toThrow();
  });

  it("imageFileName 依 contentType 給副檔名", () => {
    expect(imageFileName(0, "image/png")).toBe("docx-image-1.png");
    expect(imageFileName(1, "image/jpeg")).toBe("docx-image-2.jpg");
    expect(imageFileName(2, "image/unknown")).toBe("docx-image-3.png");
  });
});
