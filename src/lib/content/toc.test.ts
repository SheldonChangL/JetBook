import { describe, expect, it } from "vitest";
import type { ProseMirrorDoc } from "./types";
import { collectTableOfContents } from "./toc";

describe("collectTableOfContents", () => {
  it("collects H2 and H3 in render order with the same unique anchors as the reader", () => {
    const doc: ProseMirrorDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "頁面標題" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "安裝前準備" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "工具清單" }] },
        {
          type: "details",
          content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "安裝前準備" }] },
          ],
        },
      ],
    };

    expect(collectTableOfContents(doc)).toEqual([
      { id: "安裝前準備", level: 2, text: "安裝前準備" },
      { id: "工具清單", level: 3, text: "工具清單" },
      { id: "安裝前準備-1", level: 2, text: "安裝前準備" },
    ]);
  });

  it("omits empty headings and documents without H2 or H3", () => {
    expect(
      collectTableOfContents({
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
          { type: "heading", attrs: { level: 2 }, content: [] },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ],
      }),
    ).toEqual([]);
    expect(collectTableOfContents(null)).toEqual([]);
  });
});
