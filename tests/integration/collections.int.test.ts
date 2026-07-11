import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { isOrgAdmin } from "@/lib/authz/permission";
import {
  assignSpaceCollection,
  createCollection,
  deleteCollection,
  listCollections,
  renameCollection,
} from "@/lib/spaces/collections";
import { groupSpacesByCollection } from "@/lib/spaces/grouping";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import { addMember, seedSpace, seedUser } from "./helpers";

/**
 * C-09 Collection 分組整合測試（真 PG，N-01）：
 * collections CRUD、Space 指派、刪除連帶解除指派（FK set null），
 * 以及「分組只呈現使用者可存取的空間」（權限在 SQL 層過濾後才分組，不外洩不可見空間）。
 */

describe("collections CRUD 與指派", () => {
  it("create → list（position 遞增）→ rename", async () => {
    const a = await createCollection("研發部");
    const b = await createCollection("行銷部");
    expect(b.position).toBeGreaterThan(a.position);

    const all = await listCollections();
    const names = new Map(all.map((c) => [c.id, c.name]));
    expect(names.get(a.id)).toBe("研發部");
    expect(names.get(b.id)).toBe("行銷部");

    await renameCollection(a.id, "研發中心");
    const renamed = (await listCollections()).find((c) => c.id === a.id);
    expect(renamed?.name).toBe("研發中心");
  });

  it("rename/delete 不存在的 collection 擲 NOT_FOUND", async () => {
    const ghost = "00000000-0000-0000-0000-000000000000";
    await expect(renameCollection(ghost, "x")).rejects.toThrow("NOT_FOUND");
    await expect(deleteCollection(ghost)).rejects.toThrow("NOT_FOUND");
  });

  it("assignSpaceCollection 指派與移出；目標／空間不存在有明確錯誤", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const collection = await createCollection("工程");

    await assignSpaceCollection(space.id, collection.id);
    let row = await db.query.spaces.findFirst({ where: eq(spaces.id, space.id) });
    expect(row?.collectionId).toBe(collection.id);

    await assignSpaceCollection(space.id, null);
    row = await db.query.spaces.findFirst({ where: eq(spaces.id, space.id) });
    expect(row?.collectionId).toBeNull();

    const ghost = "00000000-0000-0000-0000-000000000000";
    await expect(assignSpaceCollection(space.id, ghost)).rejects.toThrow("COLLECTION_NOT_FOUND");
    await expect(assignSpaceCollection(ghost, collection.id)).rejects.toThrow("SPACE_NOT_FOUND");
  });

  it("刪除 collection 後，其中的 Space 變為未分組（FK set null），Space 本身保留", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const collection = await createCollection("暫存分組");
    await assignSpaceCollection(space.id, collection.id);

    await deleteCollection(collection.id);

    const row = await db.query.spaces.findFirst({ where: eq(spaces.id, space.id) });
    expect(row).toBeDefined();
    expect(row?.collectionId).toBeNull();
    expect((await listCollections()).some((c) => c.id === collection.id)).toBe(false);
  });
});

describe("分組只呈現使用者可存取的空間（SQL 層過濾後才分組）", () => {
  it("private 空間的分組不出現在非成員的分組結果，成員與 org admin 則可見", async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const stranger = await seedUser();
    const admin = await seedUser({ orgRole: "admin" });

    const space = await seedSpace(owner.id, { visibility: "private", name: "機密空間" });
    await addMember(space.id, owner.id, "admin");
    await addMember(space.id, member.id, "viewer");

    const collection = await createCollection("機密分組");
    await assignSpaceCollection(space.id, collection.id);

    const collectionRefs = (await listCollections()).map((c) => ({ id: c.id, name: c.name }));

    // 成員：可存取該空間 → 分組出現且含該空間。
    const memberSpaces = await listAccessibleSpaces(member);
    const memberGroups = groupSpacesByCollection(memberSpaces, collectionRefs);
    const memberGroup = memberGroups.find((g) => g.collection?.id === collection.id);
    expect(memberGroup?.spaces.map((s) => s.id)).toContain(space.id);

    // 非成員：SQL 層已濾除該私密空間 → 分組（includeEmpty=false）不出現，避免外洩。
    const strangerSpaces = await listAccessibleSpaces(stranger);
    expect(strangerSpaces.map((s) => s.id)).not.toContain(space.id);
    const strangerGroups = groupSpacesByCollection(strangerSpaces, collectionRefs);
    expect(strangerGroups.some((g) => g.collection?.id === collection.id)).toBe(false);

    // org admin：全通 → 可見。
    const adminSpaces = await listAccessibleSpaces(admin);
    const adminGroups = groupSpacesByCollection(adminSpaces, collectionRefs);
    const adminGroup = adminGroups.find((g) => g.collection?.id === collection.id);
    expect(adminGroup?.spaces.map((s) => s.id)).toContain(space.id);
  });

  it("collection 管理權限限 org admin（管理入口閘門）", () => {
    // 管理動作（建立／改名／刪除／指派）在 action 薄殼以 assertOrgAdmin 把關；
    // 對應的 org 角色判斷唯一入口為 isOrgAdmin。
    expect(isOrgAdmin({ id: "x", orgRole: "admin" })).toBe(true);
    expect(isOrgAdmin({ id: "y", orgRole: "member" })).toBe(false);
  });
});
