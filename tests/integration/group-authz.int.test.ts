import { describe, expect, it } from "vitest";
import {
  canEditPage,
  canReadPage,
  getAccessiblePageIds,
  getEditableSpaceIds,
} from "@/lib/authz/permission";
import { getSpaceRole } from "@/lib/authz/spaces";
import {
  listSpaceGroupMembers,
  listSpaceGroups,
  setSpaceGroupRole,
} from "@/lib/spaces/manage";
import {
  addGroupMember,
  addMember,
  attachGroupToSpace,
  removeGroupMemberRow,
  seedGroup,
  seedPage,
  seedSpace,
  seedUser,
} from "./helpers";

/**
 * K-03 使用者群組授權整合測試（真 PG，N-01 回歸擴充）：
 * 群組掛載授權解析、有效角色取最高、移出群組即失效（F-SEC-06）。
 * SQL 層權限過濾是 N-04 RAG 隔離的基礎，必須以真資料庫驗證正反兩向。
 */

describe("群組掛載授予存取權（K-03 主體泛化 C5）", () => {
  it("掛群組後群組成員取得該角色，非群組成員仍被拒", async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const stranger = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, owner.id, "admin");
    const page = await seedPage(space.id);

    const group = await seedGroup();
    await addGroupMember(group.id, member.id);
    await attachGroupToSpace(space.id, group.id, "editor");

    // 群組成員經群組繼承 editor 角色
    expect(await getSpaceRole(member, space.id)).toBe("editor");
    expect(await getAccessiblePageIds(member)).toContain(page.id);
    expect(await canReadPage(member, page.id)).toBe(true);
    expect(await canEditPage(member, page.id)).toBe(true);
    expect(await getEditableSpaceIds(member)).toContain(space.id);

    // 非群組成員完全不可見
    expect(await getSpaceRole(stranger, space.id)).toBeNull();
    expect(await getAccessiblePageIds(stranger)).not.toContain(page.id);
    expect(await canReadPage(stranger, page.id)).toBe(false);
  });

  it("移出群組即失效——存取權立即消失（F-SEC-06）", async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, owner.id, "admin");
    const page = await seedPage(space.id);

    const group = await seedGroup();
    await addGroupMember(group.id, member.id);
    await attachGroupToSpace(space.id, group.id, "viewer");

    expect(await getSpaceRole(member, space.id)).toBe("viewer");
    expect(await getAccessiblePageIds(member)).toContain(page.id);

    // 從群組移除該使用者
    await removeGroupMemberRow(group.id, member.id);

    // 立即失效：角色歸零、頁面不可見、不可讀
    expect(await getSpaceRole(member, space.id)).toBeNull();
    expect(await getAccessiblePageIds(member)).not.toContain(page.id);
    expect(await canReadPage(member, page.id)).toBe(false);
  });

  it("移除群組掛載即失效——setSpaceGroupRole(null)", async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id);
    const group = await seedGroup();
    await addGroupMember(group.id, member.id);
    await attachGroupToSpace(space.id, group.id, "editor");

    expect(await getAccessiblePageIds(member)).toContain(page.id);

    await setSpaceGroupRole(space.id, group.id, null);

    expect(await getSpaceRole(member, space.id)).toBeNull();
    expect(await getAccessiblePageIds(member)).not.toContain(page.id);
  });

  it("有效角色＝直接成員與各群組來源取最高", async () => {
    const owner = await seedUser();
    const user = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id);

    // 直接成員 viewer
    await addMember(space.id, user.id, "viewer");
    expect(await getSpaceRole(user, space.id)).toBe("viewer");
    expect(await canEditPage(user, page.id)).toBe(false);

    // 另掛一個 editor 群組並加入該使用者 → 取最高 editor
    const g1 = await seedGroup();
    await addGroupMember(g1.id, user.id);
    await attachGroupToSpace(space.id, g1.id, "editor");
    expect(await getSpaceRole(user, space.id)).toBe("editor");
    expect(await canEditPage(user, page.id)).toBe(true);

    // 再掛一個 admin 群組 → 取最高 admin
    const g2 = await seedGroup();
    await addGroupMember(g2.id, user.id);
    await attachGroupToSpace(space.id, g2.id, "admin");
    expect(await getSpaceRole(user, space.id)).toBe("admin");
  });

  it("editable 過濾只納入 group 角色 editor/admin，不含 viewer/commenter", async () => {
    const owner = await seedUser();
    const viewerUser = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await seedPage(space.id);

    const group = await seedGroup();
    await addGroupMember(group.id, viewerUser.id);
    await attachGroupToSpace(space.id, group.id, "viewer");

    // viewer 群組成員可讀但不可編輯 → 不在 editable space 集合
    expect(await getSpaceRole(viewerUser, space.id)).toBe("viewer");
    expect(await getEditableSpaceIds(viewerUser)).not.toContain(space.id);
  });

  it("成員表格資料：僅經群組者列於 group members，含來源群組名與有效角色", async () => {
    const owner = await seedUser();
    const direct = await seedUser();
    const viaGroup = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, direct.id, "editor");

    const group = await seedGroup({ name: `研發部 ${Date.now()}` });
    await addGroupMember(group.id, direct.id); // 同時是直接成員 → 不應重複列於 group members
    await addGroupMember(group.id, viaGroup.id);
    await attachGroupToSpace(space.id, group.id, "commenter");

    const groupMembers = await listSpaceGroupMembers(space.id);
    const viaIds = groupMembers.map((m) => m.userId);
    expect(viaIds).toContain(viaGroup.id);
    expect(viaIds).not.toContain(direct.id); // 直接成員排除，避免重複

    const row = groupMembers.find((m) => m.userId === viaGroup.id);
    expect(row?.role).toBe("commenter");
    expect(row?.groupNames).toContain(group.name);

    // 掛載群組列表含成員數與角色
    const spaceGroups = await listSpaceGroups(space.id);
    const attached = spaceGroups.find((g) => g.groupId === group.id);
    expect(attached?.role).toBe("commenter");
    expect(attached?.memberCount).toBe(2);
  });
});
