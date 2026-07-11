import { describe, expect, it } from "vitest";
import {
  createGroup,
  deleteGroup,
  importGroupMembersByEmails,
  listGroupMembers,
  listGroups,
  updateGroup,
} from "@/lib/admin/groups";
import { getSpaceRole } from "@/lib/authz/spaces";
import { getAccessiblePageIds } from "@/lib/authz/permission";
import {
  addGroupMember,
  attachGroupToSpace,
  seedGroup,
  seedPage,
  seedSpace,
  seedUser,
} from "./helpers";

/**
 * K-03 群組管理商業邏輯整合測試（真 PG，F-ADMIN-02）：
 * 群組 CRUD（名稱唯一）、CSV email 匯入（比對現有帳號、回報未命中）、刪除連帶解除掛載。
 */

describe("群組 CRUD（F-ADMIN-02）", () => {
  it("建立群組；重複名稱擲 NAME_TAKEN", async () => {
    const name = `群組-${Date.now()}`;
    const g = await createGroup({ name, description: "研發" });
    expect(g.name).toBe(name);
    await expect(createGroup({ name })).rejects.toThrow("NAME_TAKEN");
  });

  it("更新群組；改名撞名擲 NAME_TAKEN、不存在擲 NOT_FOUND", async () => {
    const a = await createGroup({ name: `A-${Date.now()}` });
    const b = await createGroup({ name: `B-${Date.now()}` });
    await expect(updateGroup(b.id, { name: a.name })).rejects.toThrow("NAME_TAKEN");
    await expect(
      updateGroup("00000000-0000-4000-8000-000000000000", { name: `X-${Date.now()}` }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("listGroups 回傳成員數", async () => {
    const g = await seedGroup();
    const u1 = await seedUser();
    const u2 = await seedUser();
    await addGroupMember(g.id, u1.id);
    await addGroupMember(g.id, u2.id);
    const list = await listGroups();
    const row = list.find((r) => r.id === g.id);
    expect(row?.memberCount).toBe(2);
  });
});

describe("CSV email 批次匯入（F-ADMIN-02）", () => {
  it("比對現有帳號（不分大小寫）加入，回報未命中與已是成員", async () => {
    const g = await seedGroup();
    const u1 = await seedUser();
    const u2 = await seedUser();

    // 第一次匯入：u1 大寫 email + 不存在的 email
    const r1 = await importGroupMembersByEmails(g.id, [
      u1.email.toUpperCase(),
      "nobody@nowhere.invalid",
    ]);
    expect(r1.added).toBe(1);
    expect(r1.alreadyMember).toBe(0);
    expect(r1.notFound).toEqual(["nobody@nowhere.invalid"]);

    // 第二次匯入：u1（已是成員）+ u2（新）
    const r2 = await importGroupMembersByEmails(g.id, [u1.email, u2.email]);
    expect(r2.added).toBe(1);
    expect(r2.alreadyMember).toBe(1);
    expect(r2.notFound).toEqual([]);

    const members = await listGroupMembers(g.id);
    expect(members.map((m) => m.userId).sort()).toEqual([u1.id, u2.id].sort());
  });
});

describe("刪除群組連帶解除掛載（F-SEC-06 相關）", () => {
  it("deleteGroup cascade 清成員與 space 掛載，存取權隨即失效", async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id);
    const g = await seedGroup();
    await addGroupMember(g.id, member.id);
    await attachGroupToSpace(space.id, g.id, "editor");

    expect(await getSpaceRole(member, space.id)).toBe("editor");
    expect(await getAccessiblePageIds(member)).toContain(page.id);

    await deleteGroup(g.id);

    expect(await getSpaceRole(member, space.id)).toBeNull();
    expect(await getAccessiblePageIds(member)).not.toContain(page.id);

    // 群組已不存在
    const list = await listGroups();
    expect(list.find((r) => r.id === g.id)).toBeUndefined();
  });
});
