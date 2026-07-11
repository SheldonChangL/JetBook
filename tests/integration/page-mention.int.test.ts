import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { countUnread, listNotifications, notifyPageMention } from "@/lib/notifications";
import { searchMentionableUsers } from "@/lib/mentions/mentionable";
import { searchLinkablePages } from "@/lib/pages/link-search";
import { resolvePageLinkTargets } from "@/lib/pages/link-resolve";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * D-11 頁面連結與 @mention 整合測試（真 PG，N-01）。
 * 涵蓋權限敏感路徑（架構鐵律 #1/#2）：mention 通知只發給有讀取權者、頁面連結解析
 * 只解可讀目標且改名自動更新（F-EDIT-12）、候選查詢在 SQL 層依權限過濾。
 */

describe("notifyPageMention（@mention 通知，K-02）", () => {
  it("通知有讀取權的被提及成員；payload 帶頁面標題與提及者、URL 指向現行 slug", async () => {
    const author = await seedUser({ name: "作者" });
    const member = await seedUser({ name: "被提及者" });
    const space = await seedSpace(author.id, { visibility: "private" });
    await addMember(space.id, author.id, "editor");
    await addMember(space.id, member.id, "viewer");
    const page = await seedPage(space.id, { title: "會議記錄" });

    await notifyPageMention({
      pageId: page.id,
      actorId: author.id,
      actorName: author.name,
      mentionedUserIds: [member.id],
    });

    const items = await listNotifications(member.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe("page_mention");
    expect(items[0]!.payload.url).toBe(`/s/${space.slug}/${page.slug}`);
    expect(items[0]!.payload.pageTitle).toBe("會議記錄");
    expect(items[0]!.payload.actorName).toBe("作者");
  });

  it("提及者本人不通知自己", async () => {
    const author = await seedUser();
    const space = await seedSpace(author.id, { visibility: "private" });
    await addMember(space.id, author.id, "editor");
    const page = await seedPage(space.id);

    await notifyPageMention({
      pageId: page.id,
      actorId: author.id,
      actorName: author.name,
      mentionedUserIds: [author.id],
    });

    expect(await countUnread(author.id)).toBe(0);
  });

  it("被提及者對該頁無讀取權（private 非成員）→ 不通知（權限預設拒絕）", async () => {
    const author = await seedUser();
    const outsider = await seedUser();
    const space = await seedSpace(author.id, { visibility: "private" });
    await addMember(space.id, author.id, "editor");
    const page = await seedPage(space.id);

    await notifyPageMention({
      pageId: page.id,
      actorId: author.id,
      actorName: author.name,
      mentionedUserIds: [outsider.id],
    });

    expect(await countUnread(outsider.id)).toBe(0);
  });

  it("org_read space：任一在職使用者皆可被提及並收到通知", async () => {
    const author = await seedUser();
    const anyone = await seedUser();
    const space = await seedSpace(author.id, { visibility: "org_read" });
    const page = await seedPage(space.id);

    await notifyPageMention({
      pageId: page.id,
      actorId: author.id,
      actorName: author.name,
      mentionedUserIds: [anyone.id],
    });

    expect(await countUnread(anyone.id)).toBe(1);
  });

  it("已刪除頁面 → 靜默略過、不擲出", async () => {
    const author = await seedUser();
    const member = await seedUser();
    const space = await seedSpace(author.id, { visibility: "org_read" });
    const page = await seedPage(space.id);
    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, page.id));

    await expect(
      notifyPageMention({
        pageId: page.id,
        actorId: author.id,
        actorName: author.name,
        mentionedUserIds: [member.id],
      }),
    ).resolves.toBeUndefined();
    expect(await countUnread(member.id)).toBe(0);
  });
});

describe("resolvePageLinkTargets（頁面連結解析，F-EDIT-12）", () => {
  it("解析可讀目標為現行 href/title；改名後自動更新（以 page id 為錨）", async () => {
    const user = await seedUser();
    const space = await seedSpace(user.id, { visibility: "org_read" });
    const target = await seedPage(space.id, { title: "舊標題" });

    const before = await resolvePageLinkTargets(user, [target.id]);
    expect(before.get(target.id)?.title).toBe("舊標題");
    expect(before.get(target.id)?.href).toBe(`/s/${space.slug}/${target.slug}`);

    // 模擬改名（slug 與 title 皆變）。連結錨在 id，故解析結果應更新。
    await db
      .update(pages)
      .set({ title: "新標題", slug: "renamed-slug" })
      .where(eq(pages.id, target.id));

    const after = await resolvePageLinkTargets(user, [target.id]);
    expect(after.get(target.id)?.title).toBe("新標題");
    expect(after.get(target.id)?.href).toBe(`/s/${space.slug}/renamed-slug`);
  });

  it("不可讀目標（private 非成員）不納入解析 Map", async () => {
    const owner = await seedUser();
    const viewer = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private" });
    const target = await seedPage(priv.id, { title: "機密頁" });

    const map = await resolvePageLinkTargets(viewer, [target.id]);
    expect(map.has(target.id)).toBe(false);
  });

  it("已刪除目標不納入解析 Map", async () => {
    const user = await seedUser();
    const space = await seedSpace(user.id, { visibility: "org_read" });
    const target = await seedPage(space.id);
    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, target.id));

    const map = await resolvePageLinkTargets(user, [target.id]);
    expect(map.has(target.id)).toBe(false);
  });
});

describe("searchMentionableUsers（@ 候選，SQL 層權限過濾）", () => {
  it("private space：只列成員與 org admin，非成員不入候選", async () => {
    // 共用測試 DB 累積他測資料，故以唯一 tag 收斂 query，讓斷言與資料量無關。
    const tag = `mtag${randomUUID().slice(0, 8)}`;
    const owner = await seedUser({ name: `${tag}-空間管理員` });
    const member = await seedUser({ name: `${tag}-小組成員甲` });
    const outsider = await seedUser({ name: `${tag}-外部人員` });
    const admin = await seedUser({ name: `${tag}-組織管理員`, orgRole: "admin" });
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, owner.id, "editor");
    await addMember(space.id, member.id, "viewer");

    const ids = new Set((await searchMentionableUsers(space.id, tag)).map((u) => u.id));
    expect(ids.has(owner.id)).toBe(true);
    expect(ids.has(member.id)).toBe(true);
    expect(ids.has(admin.id)).toBe(true); // org admin 對所有 space 有讀取權
    expect(ids.has(outsider.id)).toBe(false);
  });

  it("org_read space：全體在職使用者皆為候選；query 以姓名收斂", async () => {
    const tag = `mtag${randomUUID().slice(0, 8)}`;
    const owner = await seedUser();
    const alice = await seedUser({ name: `${tag}-Alice 陳` });
    const bob = await seedUser({ name: `${tag}-Bob 林` });
    const space = await seedSpace(owner.id, { visibility: "org_read" });

    // 非成員（alice/bob 皆非成員）在 org_read 下仍為候選。
    const both = new Set((await searchMentionableUsers(space.id, tag)).map((u) => u.id));
    expect(both.has(alice.id)).toBe(true);
    expect(both.has(bob.id)).toBe(true);

    const hits = await searchMentionableUsers(space.id, `${tag}-Alice`);
    expect(hits.some((u) => u.id === alice.id)).toBe(true);
    expect(hits.some((u) => u.id === bob.id)).toBe(false);
  });
});

describe("searchLinkablePages（頁面連結候選，SQL 層權限過濾）", () => {
  it("只回傳使用者可讀、當前 space 內、標題命中的頁面", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const guide = await seedPage(space.id, { title: "爐體安裝指南" });
    await seedPage(space.id, { title: "無關頁面" });

    const hits = await searchLinkablePages(owner, space.id, "安裝");
    expect(hits.some((p) => p.id === guide.id)).toBe(true);
    expect(hits.every((p) => p.title.includes("安裝"))).toBe(true);
  });

  it("不可讀 space 的頁面不入候選（權限預設拒絕）", async () => {
    const owner = await seedUser();
    const outsider = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private" });
    await seedPage(priv.id, { title: "機密安裝流程" });

    const hits = await searchLinkablePages(outsider, priv.id, "安裝");
    expect(hits).toHaveLength(0);
  });
});
