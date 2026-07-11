import { describe, expect, it } from "vitest";
import { insertComment } from "@/lib/comments/service";
import {
  countUnread,
  listNotifications,
  markAllRead,
  notify,
  notifyCommentReply,
} from "@/lib/notifications";
import { seedPage, seedSpace, seedUser } from "./helpers";

/**
 * K-02 站內通知整合測試（真 PG，N-01）：
 * notify 寫入／未讀計數／全部標為已讀，以及留言回覆掛點對「討論串原作者」的通知行為
 * （含略過自我通知與已刪作者）。
 */

describe("notify 與收件匣", () => {
  it("notify 寫入後可讀回、計入未讀；payload 原樣保留", async () => {
    const user = await seedUser();
    await notify(user.id, "comment_reply", {
      url: "/s/eng/onboarding",
      actorName: "Bob",
      pageTitle: "新人指南",
      excerpt: "同意你的看法",
    });

    const items = await listNotifications(user.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe("comment_reply");
    expect(items[0]!.payload.url).toBe("/s/eng/onboarding");
    expect(items[0]!.payload.actorName).toBe("Bob");
    expect(items[0]!.payload.pageTitle).toBe("新人指南");
    expect(items[0]!.readAt).toBeNull();

    expect(await countUnread(user.id)).toBe(1);
  });

  it("通知以 user_id 收斂：只看得到自己的", async () => {
    const a = await seedUser();
    const b = await seedUser();
    await notify(a.id, "comment_reply", { url: "/a" });
    await notify(b.id, "comment_reply", { url: "/b" });

    const itemsA = await listNotifications(a.id);
    expect(itemsA.every((i) => i.payload.url === "/a")).toBe(true);
    expect(await countUnread(a.id)).toBe(1);
    expect(await countUnread(b.id)).toBe(1);
  });

  it("listNotifications 依建立時間新→舊", async () => {
    const user = await seedUser();
    await notify(user.id, "comment_reply", { url: "/first" });
    await new Promise((r) => setTimeout(r, 10));
    await notify(user.id, "comment_reply", { url: "/second" });

    const items = await listNotifications(user.id);
    expect(items).toHaveLength(2);
    expect(items[0]!.payload.url).toBe("/second");
    expect(items[1]!.payload.url).toBe("/first");
  });

  it("markAllRead 將全部未讀標為已讀、未讀歸零；已讀者不變", async () => {
    const user = await seedUser();
    await notify(user.id, "comment_reply", { url: "/1" });
    await notify(user.id, "comment_reply", { url: "/2" });
    expect(await countUnread(user.id)).toBe(2);

    await markAllRead(user.id);
    expect(await countUnread(user.id)).toBe(0);
    const items = await listNotifications(user.id);
    expect(items.every((i) => i.readAt !== null)).toBe(true);
  });
});

describe("留言回覆掛點（notifyCommentReply）", () => {
  it("他人回覆討論串 → 通知原作者，payload 帶正確 URL 與摘要", async () => {
    const owner = await seedUser();
    const replier = await seedUser({ name: "回覆者" });
    const space = await seedSpace(owner.id);
    const page = await seedPage(space.id, { title: "討論頁" });

    const top = await insertComment({
      pageId: page.id,
      parentCommentId: null,
      authorId: owner.id,
      body: "頂層留言",
    });
    // 模擬 action：replier 建立回覆後掛點通知
    await insertComment({
      pageId: page.id,
      parentCommentId: top.id,
      authorId: replier.id,
      body: "這是我的回覆內容",
    });
    await notifyCommentReply({
      topLevelCommentId: top.id,
      replierId: replier.id,
      replierName: replier.name,
      replyBody: "這是我的回覆內容",
    });

    const items = await listNotifications(owner.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe("comment_reply");
    expect(items[0]!.payload.url).toBe(`/s/${space.slug}/${page.slug}`);
    expect(items[0]!.payload.actorName).toBe("回覆者");
    expect(items[0]!.payload.pageTitle).toBe("討論頁");
    expect(items[0]!.payload.excerpt).toBe("這是我的回覆內容");
    // 回覆者自己不應收到通知
    expect(await countUnread(replier.id)).toBe(0);
  });

  it("原作者回覆自己的討論串 → 不通知自己", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const page = await seedPage(space.id);
    const top = await insertComment({
      pageId: page.id,
      parentCommentId: null,
      authorId: owner.id,
      body: "頂層",
    });

    await notifyCommentReply({
      topLevelCommentId: top.id,
      replierId: owner.id,
      replierName: owner.name,
      replyBody: "自我回覆",
    });

    expect(await countUnread(owner.id)).toBe(0);
    expect(await listNotifications(owner.id)).toHaveLength(0);
  });

  it("原作者已刪（authorId null）→ 靜默略過，不擲出", async () => {
    const owner = await seedUser();
    const replier = await seedUser();
    const space = await seedSpace(owner.id);
    const page = await seedPage(space.id);
    // authorId null 模擬帳號刪除後留言保留
    const top = await insertComment({
      pageId: page.id,
      parentCommentId: null,
      authorId: owner.id,
      body: "頂層",
    });
    // 直接把該留言作者清空（模擬 set null）
    const { db } = await import("@/lib/db");
    const { comments } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(comments).set({ authorId: null }).where(eq(comments.id, top.id));

    await expect(
      notifyCommentReply({
        topLevelCommentId: top.id,
        replierId: replier.id,
        replierName: replier.name,
        replyBody: "回覆",
      }),
    ).resolves.toBeUndefined();
    // 無任何人收到通知
    expect(await countUnread(replier.id)).toBe(0);
  });
});
