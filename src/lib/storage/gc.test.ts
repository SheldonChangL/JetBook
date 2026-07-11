import { describe, expect, it } from "vitest";
import { collectReferencedAttachmentIds } from "./gc";

/**
 * 孤兒附件 GC 引用擷取（M-03）單元測試：走訪 TipTap JSON 的 image src 與 attachment
 * 節點，精確蒐集被引用的 attachmentId。此為孤兒判定的唯一事實來源，須與編輯器／
 * 渲染兩端的引用格式一致。DB 相關回收行為由整合測試（真 PG）涵蓋。
 */
describe("collectReferencedAttachmentIds", () => {
  it("擷取 image 節點 src=/api/files/<id> 的 attachmentId", () => {
    const doc = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "/api/files/img-1", alt: "x" } }],
    };
    expect([...collectReferencedAttachmentIds(doc)]).toEqual(["img-1"]);
  });

  it("擷取 attachment 節點 attrs.attachmentId", () => {
    const doc = {
      type: "doc",
      content: [{ type: "attachment", attrs: { attachmentId: "file-9", fileName: "a.pdf" } }],
    };
    expect([...collectReferencedAttachmentIds(doc)]).toEqual(["file-9"]);
  });

  it("遞迴深層巢狀（callout／table 內的引用）並去重", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "callout",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "hi" }] },
            { type: "image", attrs: { src: "/api/files/dup" } },
          ],
        },
        { type: "attachment", attrs: { attachmentId: "dup" } },
        { type: "attachment", attrs: { attachmentId: "unique" } },
      ],
    };
    const ids = collectReferencedAttachmentIds(doc);
    expect([...ids].sort()).toEqual(["dup", "unique"]);
  });

  it("忽略外部圖片與非上傳 src（只認同源 /api/files/）", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "https://evil.example/x.png" } },
        { type: "image", attrs: { src: "/other/path/y.png" } },
        { type: "image", attrs: {} },
      ],
    };
    expect([...collectReferencedAttachmentIds(doc)]).toEqual([]);
  });

  it("容忍帶子路徑或查詢字串的 src，仍取出乾淨 id", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "/api/files/id-q?w=100" } },
        { type: "image", attrs: { src: "/api/files/id-h#frag" } },
      ],
    };
    expect([...collectReferencedAttachmentIds(doc)].sort()).toEqual(["id-h", "id-q"]);
  });

  it("空／null／非物件內容不擲錯，回空集合", () => {
    expect([...collectReferencedAttachmentIds(null)]).toEqual([]);
    expect([...collectReferencedAttachmentIds(undefined)]).toEqual([]);
    expect([...collectReferencedAttachmentIds("nope")]).toEqual([]);
    expect([...collectReferencedAttachmentIds({ type: "doc" })]).toEqual([]);
  });
});
