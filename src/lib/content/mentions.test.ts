import { describe, expect, it } from "vitest";
import {
  collectMentionUserIds,
  collectPageLinkIds,
  newlyMentionedUserIds,
} from "./mentions";
import type { ProseMirrorDoc } from "./types";

/** 組出含 @mention 與 pageLink 的文件（mention/pageLink 為 inline atom，attrs.id 為錨）。 */
function docWith(mentions: string[], pageLinks: string[]): ProseMirrorDoc {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "hi " },
          ...mentions.map((id) => ({
            type: "mention",
            attrs: { id, label: `使用者${id}` },
          })),
          ...pageLinks.map((id) => ({
            type: "pageLink",
            attrs: { id, label: `頁面${id}` },
          })),
        ],
      },
    ],
  };
}

describe("collectMentionUserIds / collectPageLinkIds", () => {
  it("蒐集 mention 的 user id 並去重", () => {
    const doc = docWith(["u1", "u2", "u1"], ["p1"]);
    expect([...collectMentionUserIds(doc)].sort()).toEqual(["u1", "u2"]);
  });

  it("蒐集 pageLink 的 page id 並去重", () => {
    const doc = docWith(["u1"], ["p1", "p2", "p2"]);
    expect([...collectPageLinkIds(doc)].sort()).toEqual(["p1", "p2"]);
  });

  it("深層巢狀（清單/表格內）也蒐集得到", () => {
    const doc: ProseMirrorDoc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "mention", attrs: { id: "deep", label: "深" } }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect([...collectMentionUserIds(doc)]).toEqual(["deep"]);
  });

  it("空／null 文件回傳空集合", () => {
    expect(collectMentionUserIds(null).size).toBe(0);
    expect(collectPageLinkIds(undefined).size).toBe(0);
    expect(collectMentionUserIds({ type: "doc" }).size).toBe(0);
  });

  it("忽略缺 id 或 id 非字串的節點", () => {
    const doc: ProseMirrorDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { label: "無 id" } },
            { type: "mention", attrs: { id: 123 as unknown as string } },
            { type: "mention", attrs: { id: "" } },
            { type: "mention", attrs: { id: "ok" } },
          ],
        },
      ],
    };
    expect([...collectMentionUserIds(doc)]).toEqual(["ok"]);
  });
});

describe("newlyMentionedUserIds", () => {
  it("只回傳相對舊版新增的 mention（既有者不重複）", () => {
    const prev = docWith(["u1"], []);
    const next = docWith(["u1", "u2", "u3"], []);
    expect(newlyMentionedUserIds(prev, next).sort()).toEqual(["u2", "u3"]);
  });

  it("舊版為 null（新頁）時，全部 mention 皆視為新增", () => {
    const next = docWith(["u1", "u2"], []);
    expect(newlyMentionedUserIds(null, next).sort()).toEqual(["u1", "u2"]);
  });

  it("無新增時回傳空陣列（移除 mention 不觸發）", () => {
    const prev = docWith(["u1", "u2"], []);
    const next = docWith(["u1"], []);
    expect(newlyMentionedUserIds(prev, next)).toEqual([]);
  });
});
