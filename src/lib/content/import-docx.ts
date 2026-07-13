import "server-only";
import mammoth from "mammoth";
import TurndownService from "turndown";
// @ts-expect-error turndown-plugin-gfm 無型別定義（MIT；提供 GFM 表格/刪除線轉換）
import { gfm } from "turndown-plugin-gfm";

/**
 * .docx → Markdown 轉換（M4-08，F-IE-03 子集）。
 * 管線：mammoth（docx→語意 HTML）→ turndown+gfm（HTML→Markdown）→
 * 既有 markdown-to-doc / savePage 儲存管線（鐵律 5：不旁路）。
 * 圖片：轉換階段僅收集 bytes 並以 docx-image://<n> 佔位；呼叫端建頁後上傳為附件，
 * 再經 resolveImageSrc 改寫為 /api/files/<id>（同 J-02 Zip 匯入模式）。
 */

/** 圖片佔位 scheme：markdown 中的 ![alt](docx-image://<n>) 由呼叫端解析。 */
export const DOCX_IMAGE_SCHEME = "docx-image://";

export interface DocxImage {
  /** 佔位索引（對應 docx-image://<index>） */
  index: number;
  contentType: string;
  data: Buffer;
}

export interface DocxConversion {
  markdown: string;
  images: DocxImage[];
  /** mammoth 轉換警告（不支援樣式等），僅供記錄 */
  warnings: string[];
}

/** contentType → 附件檔名副檔名（白名單內的圖片型別）。 */
export function imageFileName(index: number, contentType: string): string {
  const ext =
    {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
    }[contentType] ?? ".png";
  return `docx-image-${index + 1}${ext}`;
}

/**
 * 表格正規化（mammoth 輸出為規則的無屬性巢狀標籤，可安全字串處理）：
 * 1. 儲存格內的 <p> 攤平為行內文字（GFM 儲存格不允許換行，段落間以空白相接）；
 * 2. 每個表格首列 td → th（turndown-plugin-gfm 只轉換含標題列的表格）。
 */
function normalizeTables(html: string): string {
  const flattened = html.replace(/<(td|th)>([\s\S]*?)<\/\1>/g, (_m, tag: string, inner: string) => {
    const inline = inner
      .replace(/<\/p>\s*<p>/g, " ")
      .replace(/<\/?p>/g, "")
      .trim();
    return `<${tag}>${inline}</${tag}>`;
  });
  return flattened.replace(/<table>\s*<tr>([\s\S]*?)<\/tr>/g, (_m, firstRow: string) => {
    const headerRow = firstRow.replace(/<td(\s|>)/g, "<th$1").replace(/<\/td>/g, "</th>");
    return `<table><tr>${headerRow}</tr>`;
  });
}

/** 解析失敗（非 docx／損壞）擲出，呼叫端轉為明確錯誤碼；不產生任何資料列。 */
export async function docxToMarkdown(buffer: Buffer): Promise<DocxConversion> {
  const images: DocxImage[] = [];

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.readAsBase64String();
        const index = images.length;
        images.push({
          index,
          contentType: image.contentType ?? "image/png",
          data: Buffer.from(base64, "base64"),
        });
        return { src: `${DOCX_IMAGE_SCHEME}${index}` };
      }),
    },
  );

  const html = normalizeTables(result.value);

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  turndown.use(gfm);
  const markdown = turndown.turndown(html);

  return {
    markdown,
    images,
    warnings: result.messages.map((m) => m.message),
  };
}
