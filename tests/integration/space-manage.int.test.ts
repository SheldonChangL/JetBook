import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaces, users } from "@/lib/db/schema";
import { can, getSpaceRole } from "@/lib/authz/permission";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import {
  listActiveUsers,
  listSpaceMembers,
  setSpaceArchived,
  setSpaceMemberRole,
} from "@/lib/spaces/manage";
import { addMember, seedSpace, seedUser } from "./helpers";

/**
 * C-07 Space 權限管理整合測試（真 PG，N-01）：
 * 成員角色變更（最後一位 admin 保護）、封存隱藏、可見性變更即時生效、管理權限閘門。
 */

describe("setSpaceMemberRole（成員角色變更 + 最後一位 admin 保護）", () => {
  it("新增成員與升降級（upsert）", async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const space = await seedSpace(owner.id);
    await addMember(space.id, owner.id, "admin");

    await setSpaceMemberRole(space.id, member.id, "viewer");
    expect(await getSpaceRole(member, space.id)).toBe("viewer");

    await setSpaceMemberRole(space.id, member.id, "editor");
    expect(await getSpaceRole(member, space.id)).toBe("editor");

    const rows = await listSpaceMembers(space.id);
    expect(rows.find((r) => r.userId === member.id)?.role).toBe("editor");
    expect(rows.find((r) => r.userId === member.id)?.email).toBe(member.email);
  });

  it("不可降級最後一位 admin", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    await addMember(space.id, owner.id, "admin");

    await expect(setSpaceMemberRole(space.id, owner.id, "editor")).rejects.toThrow("LAST_ADMIN");
    expect(await getSpaceRole(owner, space.id)).toBe("admin");
  });

  it("不可移除最後一位 admin", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    await addMember(space.id, owner.id, "admin");

    await expect(setSpaceMemberRole(space.id, owner.id, null)).rejects.toThrow("LAST_ADMIN");
    expect(await getSpaceRole(owner, space.id)).toBe("admin");
  });

  it("存在第二位 admin 時可降級/移除原 admin", async () => {
    const owner = await seedUser();
    const second = await seedUser();
    const space = await seedSpace(owner.id);
    await addMember(space.id, owner.id, "admin");
    await addMember(space.id, second.id, "admin");

    await setSpaceMemberRole(space.id, owner.id, "editor");
    expect(await getSpaceRole(owner, space.id)).toBe("editor");

    // second 為唯一 admin，改動 owner（非 admin）可移除
    await setSpaceMemberRole(space.id, owner.id, null);
    const rows = await listSpaceMembers(space.id);
    expect(rows.find((r) => r.userId === owner.id)).toBeUndefined();
  });
});

describe("封存（archived_at）自列表與搜尋隱藏", () => {
  it("封存後 listAccessibleSpaces 不再包含；取消封存後恢復", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, owner.id, "admin");

    expect((await listAccessibleSpaces(owner)).map((s) => s.id)).toContain(space.id);

    await setSpaceArchived(space.id, true);
    expect((await listAccessibleSpaces(owner)).map((s) => s.id)).not.toContain(space.id);

    await setSpaceArchived(space.id, false);
    expect((await listAccessibleSpaces(owner)).map((s) => s.id)).toContain(space.id);
  });
});

describe("受限 space 對未授權者不可見 / 權限變更下一請求生效", () => {
  it("private space 對非成員不出現在列表，且無角色", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, owner.id, "admin");

    expect((await listAccessibleSpaces(stranger)).map((s) => s.id)).not.toContain(space.id);
    expect(await getSpaceRole(stranger, space.id)).toBeNull();
  });

  it("可見性改為 org_read 後，非成員下一次查詢即取得 viewer 角色", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, owner.id, "admin");

    expect(await getSpaceRole(stranger, space.id)).toBeNull();
    await db.update(spaces).set({ visibility: "org_read" }).where(eq(spaces.id, space.id));
    expect(await getSpaceRole(stranger, space.id)).toBe("viewer");
    expect((await listAccessibleSpaces(stranger)).map((s) => s.id)).toContain(space.id);
  });
});

describe("space.manage 閘門（僅 admin 可管理權限）", () => {
  it("admin 可管理、viewer/非成員不可", async () => {
    const owner = await seedUser();
    const viewer = await seedUser();
    const stranger = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    await addMember(space.id, owner.id, "admin");
    await addMember(space.id, viewer.id, "viewer");

    const resource = { type: "space" as const, spaceId: space.id };
    expect(await can(owner, "space.manage", resource)).toBe(true);
    expect(await can(viewer, "space.manage", resource)).toBe(false);
    // org_read 隱含 viewer，仍不可管理
    expect(await can(stranger, "space.manage", resource)).toBe(false);
  });
});

describe("listActiveUsers（加入成員候選來源）", () => {
  it("僅回傳啟用中使用者", async () => {
    const active = await seedUser();
    const inactive = await seedUser();
    await db.update(users).set({ isActive: false }).where(eq(users.id, inactive.id));

    const ids = (await listActiveUsers()).map((u) => u.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });
});
