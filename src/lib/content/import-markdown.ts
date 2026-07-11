import { markdownToDoc, type MarkdownToDocOptions } from "./markdown-to-doc";
import type { ProseMirrorDoc, ProseMirrorNode } from "./types";

/** 頁面標題長度上限（對齊 pages.title 與 createPage 的 z.string().max(200)）。 */
export const IMPORT_TITLE_MAX = 200;

/** 取節點的純文字（供從標題節點萃取頁面標題）。 */
function nodeText(node: ProseMirrorNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(nodeText).join("");
}

/** 去除 .md/.markdown 副檔名與路徑，作為標題保底。 */
export function titleFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.(md|markdown|mdown|mkd|mkdn)$/i, "").trim();
}

export interface MarkdownImport {
  title: string;
  doc: ProseMirrorDoc;
}

/**
 * 單檔 Markdown 匯入內容組裝（J-01）：markdown → doc（重用 markdown-to-doc 轉換器），
 * 並萃取頁面標題。首個區塊為 H1 時取其文字為標題並自本文移除——避免與閱讀頁
 * 另行渲染的 <h1>{page.title} 重複（G-02）；否則以檔名（去副檔名）為標題。
 *
 * 不寫入任何資料：純內容組裝，交由呼叫端經 createPage + savePage 走既有儲存管線
 * （三欄同交易同步，架構鐵律 #5），不旁路。
 *
 * `options.resolveImageSrc`（J-02 Zip 匯入）：解析同源上傳圖片，使單獨成段的圖片
 * 產生 block image 節點；未帶時（J-01 單檔）維持外部圖片降級為連結。
 */
export function buildMarkdownImport(
  markdown: string,
  fileName: string,
  options?: MarkdownToDocOptions,
): MarkdownImport {
  const doc = markdownToDoc(markdown, options);
  const content = doc.content ?? [];
  const first = content[0];

  let title = "";
  let body: ProseMirrorNode[] = content;
  if (first && first.type === "heading" && Number(first.attrs?.level) === 1) {
    title = nodeText(first).trim();
    body = content.slice(1);
  }
  if (!title) title = titleFromFileName(fileName);
  title = title.slice(0, IMPORT_TITLE_MAX).trim();

  return { title, doc: { type: "doc", content: body } };
}
