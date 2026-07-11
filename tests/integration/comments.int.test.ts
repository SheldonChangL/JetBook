import { describe, expect, it } from "vitest";
import { can } from "@/lib/authz/permission";
import {
  getCommentWithSpace,
  insertComment,
  listPageComments,
  setCommentResolved,
  softDeleteComment,
  updateCommentBody,
} from "@/lib/comments/service";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * K-01 頁面留言整合測試（真 PG，N-01）：
 * 權限相關（commenter 可留言、viewer 不可、刪除限本人或 space admin）必以真資料庫驗證。
 */

describe("留言權限（page.comment）", () => {
  it("commenter 可留言、viewer 不可（private space）", async () => {
    const owner = await seedUser();
    const commenter = await seedUser();
    const viewer = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, commenter.id, "commenter");
    await addMember(space.id, viewer.id, "viewer");
    const page = await seedPage(space.id);
    const resource = { type: "page" as const, spaceId: space.id };

    expect(await can(commenter, "page.comment", resource)).toBe(true);
    // viewer 可讀但不可留言（C3 四級角色）
    expect(await can(viewer, "page.read", resource)).toBe(true);
    expect(await can(viewer, "page.comment", resource)).toBe(false);

    // commenter 實際留言後，頁面討論串可讀回
    const created = await insertComment({
      pageId: page.id,
      parentCommentId: null,
      authorId: commenter.id,
      body: "第一則留言",
    });
    const threads = await listPageComments(page.id);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.id).toBe(created.id);
    expect(threads[0]!.body).toBe("第一則留言");
    expect(threads[0]!.authorName).toBe(commenter.name);
  });

  it("非成員對 private space 無留言權；org_read 隱含 viewer 亦不可留言", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private" });
    const orgRead = await seedSpace(owner.id, { visibility: "org_read" });

    expect(await can(stranger, "page.comment", { type: "page", spaceId: priv.id })).toBe(false);
    // org_read 給非成員隱含 viewer → 可讀不可留言
    expect(await can(stranger, "page.read", { type: "page", spaceId: orgRead.id })).toBe(true);
    expect(await can(stranger, "page.comment", { type: "page", spaceId: orgRead.id })).toBe(false);
  });

  it("editor / space admin / org admin 均可留言", async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const spaceAdmin = await seedUser();
    const orgAdmin = await seedUser({ orgRole: "admin" });
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, editor.id, "editor");
    await addMember(space.id, spaceAdmin.id, "admin");
    const resource = { type: "page" as const, spaceId: space.id };

    expect(await can(editor, "page.comment", resource)).toBe(true);
    expect(await can(spaceAdmin, "page.comment", resource)).toBe(true);
    expect(await can(orgAdmin, "page.comment", resource)).toBe(true);
  });
});

describe("刪除權限（本人或 space admin）", () => {
  it("space admin 有 space.manage、一般 commenter 無", async () => {
    const owner = await seedUser();
    const commenter = await seedUser();
    const spaceAdmin = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, commenter.id, "commenter");
    await addMember(space.id, spaceAdmin.id, "admin");
    const resource = { type: "space" as const, spaceId: space.id };

    expect(await can(spaceAdmin, "space.manage", resource)).toBe(true);
    expect(await can(commenter, "space.manage", resource)).toBe(false);
  });

  it("getCommentWithSpace 回傳留言與所屬 spaceId（供刪除授權）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id);
    const c = await insertComment({
      pageId: page.id,
      parentCommentId: null,
      authorId: owner.id,
      body: "x",
    });

    const found = await getCommentWithSpace(c.id);
    expect(found).not.toBeNull();
    expect(found!.spaceId).toBe(space.id);
    expect(found!.comment.authorId).toBe(owner.id);
  });
});

describe("討論串組裝與狀態", () => {
  it("回覆巢狀於頂層留言、對回覆的回覆歸位到頂層（單層）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const page = await seedPage(space.id);

    const top = await insertComment({
      pageId: page.id,
      parentCommentId: null,
      authorId: owner.id,
      body: "頂層",
    });
    await insertComment({
      pageId: page.id,
      parentCommentId: top.id,
      authorId: owner.id,
      body: "回覆一",
    });
    await insertComment({
      pageId: page.id,
      parentCommentId: top.id,
      authorId: owner.id,
      body: "回覆二",
    });

    const threads = await listPageComments(page.id);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.replies.map((r) => r.body)).toEqual(["回覆一", "回覆二"]);
  });

  it("已解決留言帶 resolvedAt、重新開啟清空", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const page = await seedPage(space.id);
    const c = await insertComment({
      pageId: page.id,
      parentCommentId: null,
      authorId: owner.id,
      body: "待解決",
    });

    await setCommentResolved(c.id, true);
    let threads = await listPageComments(page.id);
    expect(threads[0]!.resolvedAt).not.toBeNull();

    await setCommentResolved(c.id, false);
    threads = await listPageComments(page.id);
    expect(threads[0]!.resolvedAt).toBeNull();
  });

  it("編輯更新內文", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const page = await seedPage(space.id);
    const c = await insertComment({
      pageId: page.id,
      parentCommentId: null,
      authorId: owner.id,
      body: "原文",
    });

    await updateCommentBody(c.id, "改後");
    const threads = await listPageComments(page.id);
    expect(threads[0]!.body).toBe("改後");
  });
});

describe("軟刪除與墓碑", () => {
  it("刪除的回覆被排除；刪除但仍有回覆的頂層留言以墓碑顯示", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const page = await seedPage(space.id);

    const top = await insertComment({
      pageId: page.id,
      parentCommentId: null,
      authorId: owner.id,
      body: "頂層原文",
    });
    await insertComment({
      pageId: page.id,
      parentCommentId: top.id,
      authorId: owner.id,
      body: "回覆保留",
    });
    const reply2 = await insertComment({
      pageId: page.id,
      parentCommentId: top.id,
      authorId: owner.id,
      body: "回覆刪除",
    });

    await softDeleteComment(reply2.id);
    await softDeleteComment(top.id);

    const threads = await listPageComments(page.id);
    expect(threads).toHaveLength(1);
    // 頂層墓碑：deleted、無內文、無作者
    expect(threads[0]!.deleted).toBe(true);
    expect(threads[0]!.body).toBe("");
    expect(threads[0]!.authorName).toBeNull();
    // 保留的回覆仍在、刪除的回覆排除
    expect(threads[0]!.replies.map((r) => r.body)).toEqual(["回覆保留"]);
  });

  it("刪除且無可見回覆的頂層留言整串隱藏", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const page = await seedPage(space.id);
    const c = await insertComment({
      pageId: page.id,
      parentCommentId: null,
      authorId: owner.id,
      body: "孤立",
    });

    await softDeleteComment(c.id);
    const threads = await listPageComments(page.id);
    expect(threads).toHaveLength(0);
  });
});
