import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, spaces } from "@/lib/db/schema";
import { can, getAccessiblePageIds, getSpaceRole } from "@/lib/authz/permission";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import {
  listDeletedSpaces,
  purgeExpiredSpaces,
  restoreSpace,
  setSpaceArchived,
  softDeleteSpace,
  SPACE_TRASH_RETENTION_DAYS,
} from "@/lib/spaces/manage";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * C-12 Space 封存與軟刪除整合測試（真 PG，N-01；F-ORG-04）。涵蓋：
 * - 封存唯讀：封存 space 拒絕寫入動作、仍可讀取／管理（解除封存）、不進搜尋（getAccessiblePageIds）
 * - 軟刪不可見：空間與其頁面自列表、搜尋、RAG 隱藏，getSpaceRole 回 null
 * - 還原恢復：清除 deleted_at 後空間與頁面恢復可見；逾保留期不可還原
 * - 逾期清除：purgeExpiredSpaces 硬刪逾期空間並 FK cascade 其頁面，保留近期
 */

/** 把 space 的 deleted_at 直接設為指定時間（模擬逾期，繞過商業邏輯保留期限制）。 */
async function backdateDeletedAt(spaceId: string, when: Date) {
  await db.update(spaces).set({ deletedAt: when }).where(eq(spaces.id, spaceId));
}

describe("封存唯讀（F-ORG-04 驗收 1）", () => {
  it("封存後拒絕寫入動作、仍可讀取與管理，且不進搜尋", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, owner.id, "admin");
    const page = await seedPage(space.id, { title: "封存前頁", contentText: "內容" });

    const pageRes = { type: "page" as const, spaceId: space.id };
    const spaceRes = { type: "space" as const, spaceId: space.id };

    // 封存前：可編輯、可讀、頁面在可存取集合內
    expect(await can(owner, "page.edit", pageRes)).toBe(true);
    expect((await getAccessiblePageIds(owner)).includes(page.id)).toBe(true);

    await setSpaceArchived(space.id, true);

    // 封存後：寫入一律拒絕
    expect(await can(owner, "page.edit", pageRes)).toBe(false);
    expect(await can(owner, "page.delete", pageRes)).toBe(false);
    expect(await can(owner, "page.comment", pageRes)).toBe(false);
    expect(await can(owner, "space.edit", spaceRes)).toBe(false);
    // 讀取與管理（供解除封存）仍放行
    expect(await can(owner, "page.read", pageRes)).toBe(true);
    expect(await can(owner, "space.manage", spaceRes)).toBe(true);
    // 不進搜尋／RAG：頁面自可存取集合排除
    expect((await getAccessiblePageIds(owner)).includes(page.id)).toBe(false);

    // 解除封存後恢復可寫、可搜尋
    await setSpaceArchived(space.id, false);
    expect(await can(owner, "page.edit", pageRes)).toBe(true);
    expect((await getAccessiblePageIds(owner)).includes(page.id)).toBe(true);
  });

  it("org admin 也受封存唯讀約束（read-only 對所有人）", async () => {
    const orgAdmin = await seedUser({ orgRole: "admin" });
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await setSpaceArchived(space.id, true);

    const pageRes = { type: "page" as const, spaceId: space.id };
    expect(await can(orgAdmin, "page.edit", pageRes)).toBe(false);
    expect(await can(orgAdmin, "page.read", pageRes)).toBe(true);
  });
});

describe("軟刪不可見（F-ORG-04 驗收 2）", () => {
  it("軟刪後空間與頁面自列表、搜尋、角色全面隱藏", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    await addMember(space.id, owner.id, "admin");
    const page = await seedPage(space.id, { title: "軟刪頁", contentText: "內容" });

    expect((await listAccessibleSpaces(owner)).map((s) => s.id)).toContain(space.id);
    expect((await getAccessiblePageIds(owner)).includes(page.id)).toBe(true);

    await softDeleteSpace(space.id);

    expect((await listAccessibleSpaces(owner)).map((s) => s.id)).not.toContain(space.id);
    expect((await getAccessiblePageIds(owner)).includes(page.id)).toBe(false);
    expect(await getSpaceRole(owner, space.id)).toBeNull();
    // 管理入口也關閉（角色 null）
    expect(await can(owner, "space.manage", { type: "space", spaceId: space.id })).toBe(false);
    // 頁面資料仍在（僅隱藏，未硬刪）
    expect(await db.query.pages.findFirst({ where: eq(pages.id, page.id) })).toBeDefined();
  });

  it("軟刪為冪等：重複刪除保持同一 deleted_at", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const first = await softDeleteSpace(space.id);
    const second = await softDeleteSpace(space.id);
    expect(second.getTime()).toBe(first.getTime());
  });
});

describe("還原恢復", () => {
  it("30 天內還原後空間與頁面恢復可見", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    await addMember(space.id, owner.id, "admin");
    const page = await seedPage(space.id, { title: "待還原頁", contentText: "內容" });

    await softDeleteSpace(space.id);
    const restored = await restoreSpace(space.id);
    expect(restored.slug).toBe(space.slug);

    expect((await listAccessibleSpaces(owner)).map((s) => s.id)).toContain(space.id);
    expect((await getAccessiblePageIds(owner)).includes(page.id)).toBe(true);
    expect(await getSpaceRole(owner, space.id)).toBe("admin");
  });

  it("逾保留期不可還原（擲 NOT_FOUND，deleted_at 不變）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await softDeleteSpace(space.id);
    const expired = new Date(Date.now() - (SPACE_TRASH_RETENTION_DAYS + 1) * 86_400_000);
    await backdateDeletedAt(space.id, expired);

    await expect(restoreSpace(space.id)).rejects.toThrow("NOT_FOUND");
    const row = await db.query.spaces.findFirst({ where: eq(spaces.id, space.id) });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("不存在的 space 還原擲 NOT_FOUND", async () => {
    await expect(restoreSpace(crypto.randomUUID())).rejects.toThrow("NOT_FOUND");
  });
});

describe("listDeletedSpaces（後台可還原清單）", () => {
  it("列出保留期內軟刪空間，排除未刪與逾期", async () => {
    const owner = await seedUser();
    const active = await seedSpace(owner.id, { visibility: "private" });
    const recent = await seedSpace(owner.id, { visibility: "private" });
    const expired = await seedSpace(owner.id, { visibility: "private" });

    await softDeleteSpace(recent.id);
    await softDeleteSpace(expired.id);
    await backdateDeletedAt(
      expired.id,
      new Date(Date.now() - (SPACE_TRASH_RETENTION_DAYS + 1) * 86_400_000),
    );

    const ids = (await listDeletedSpaces()).map((s) => s.id);
    expect(ids).toContain(recent.id);
    expect(ids).not.toContain(active.id);
    expect(ids).not.toContain(expired.id);
  });
});

describe("逾期永久清除（purgeExpiredSpaces）", () => {
  it("硬刪逾期空間並 FK cascade 其頁面，保留近期軟刪", async () => {
    const owner = await seedUser();
    const expiredSpace = await seedSpace(owner.id, { visibility: "private" });
    const expiredPage = await seedPage(expiredSpace.id, { title: "逾期空間頁" });
    const recentSpace = await seedSpace(owner.id, { visibility: "private" });
    const recentPage = await seedPage(recentSpace.id, { title: "近期空間頁" });

    await softDeleteSpace(expiredSpace.id);
    await backdateDeletedAt(
      expiredSpace.id,
      new Date(Date.now() - (SPACE_TRASH_RETENTION_DAYS + 1) * 86_400_000),
    );
    await softDeleteSpace(recentSpace.id);

    const purged = await purgeExpiredSpaces();
    expect(purged).toBeGreaterThanOrEqual(1);

    // 逾期空間與其頁面級聯清除
    expect(await db.query.spaces.findFirst({ where: eq(spaces.id, expiredSpace.id) })).toBeUndefined();
    expect(await db.query.pages.findFirst({ where: eq(pages.id, expiredPage.id) })).toBeUndefined();
    // 近期軟刪空間與頁面保留
    expect(await db.query.spaces.findFirst({ where: eq(spaces.id, recentSpace.id) })).toBeDefined();
    expect(await db.query.pages.findFirst({ where: eq(pages.id, recentPage.id) })).toBeDefined();
  });
});
