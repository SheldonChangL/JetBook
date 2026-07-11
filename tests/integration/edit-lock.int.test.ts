import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import {
  acquireLock,
  heartbeatLock,
  releaseLock,
  getLockState,
  LOCK_IDLE_MS,
} from "@/lib/pages/lock";
import { seedPage, seedSpace, seedUser } from "./helpers";

/**
 * D-09 軟性編輯鎖狀態機整合測試（真 PG，N-01 / F-COLLAB-01）：
 * 取鎖 → 他人拒絕 → 心跳中止逾時可取 → Admin 搶鎖降級 → 持有者釋放。
 * 涵蓋授權（可取/續租）與拒絕（他人取鎖失敗、非持有者心跳/釋放無效）兩向。
 */

async function makeFixture() {
  const alice = await seedUser({ name: "Alice 編輯者" });
  const bob = await seedUser({ name: "Bob 編輯者" });
  const admin = await seedUser({ orgRole: "admin", name: "Admin 管理者" });
  const space = await seedSpace(alice.id);
  const page = await seedPage(space.id);
  return { alice, bob, admin, page };
}

describe("acquireLock（取鎖與拒絕）", () => {
  it("首位使用者取鎖成功，第二位於未逾時期間取鎖失敗", async () => {
    const { alice, bob, page } = await makeFixture();
    expect(await acquireLock(page.id, alice.id)).toBe(true);
    expect(await acquireLock(page.id, bob.id)).toBe(false);
  });

  it("持有者重入視為續租，仍取鎖成功", async () => {
    const { alice, page } = await makeFixture();
    expect(await acquireLock(page.id, alice.id)).toBe(true);
    expect(await acquireLock(page.id, alice.id)).toBe(true);
  });

  it("已刪除頁面不可取鎖", async () => {
    const { alice, page } = await makeFixture();
    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, page.id));
    expect(await acquireLock(page.id, alice.id)).toBe(false);
  });
});

describe("getLockState（含持有者姓名 join）", () => {
  it("他人持鎖時回傳 lockedByOther 與持有者姓名", async () => {
    const { alice, bob, page } = await makeFixture();
    await acquireLock(page.id, alice.id);
    const state = await getLockState(page.id, bob.id);
    expect(state.lockedByMe).toBe(false);
    expect(state.lockedByOther).toBe(true);
    expect(state.lockedBy).toBe(alice.id);
    expect(state.lockedByName).toBe(alice.name);
  });

  it("自己持鎖時 lockedByMe 為真", async () => {
    const { alice, page } = await makeFixture();
    await acquireLock(page.id, alice.id);
    const state = await getLockState(page.id, alice.id);
    expect(state.lockedByMe).toBe(true);
    expect(state.lockedByOther).toBe(false);
  });

  it("逾時鎖視為無鎖（lockedBy=null、無姓名）", async () => {
    const { alice, bob, page } = await makeFixture();
    await acquireLock(page.id, alice.id);
    await db
      .update(pages)
      .set({ lockedAt: new Date(Date.now() - LOCK_IDLE_MS - 1000) })
      .where(eq(pages.id, page.id));
    const state = await getLockState(page.id, bob.id);
    expect(state.lockedBy).toBeNull();
    expect(state.lockedByName).toBeNull();
    expect(state.lockedByOther).toBe(false);
  });
});

describe("heartbeatLock（心跳續租與中止逾時釋放）", () => {
  it("持有者心跳成功，非持有者心跳失敗", async () => {
    const { alice, bob, page } = await makeFixture();
    await acquireLock(page.id, alice.id);
    expect(await heartbeatLock(page.id, alice.id)).toBe(true);
    expect(await heartbeatLock(page.id, bob.id)).toBe(false);
  });

  it("心跳中止逾時後鎖自動釋放，他人可取得", async () => {
    const { alice, bob, page } = await makeFixture();
    await acquireLock(page.id, alice.id);
    // 模擬心跳中止：lockedAt 退回逾時窗之外
    await db
      .update(pages)
      .set({ lockedAt: new Date(Date.now() - LOCK_IDLE_MS - 1000) })
      .where(eq(pages.id, page.id));
    expect(await acquireLock(page.id, bob.id)).toBe(true);
  });
});

describe("Admin 搶鎖（force）與降級偵測", () => {
  it("Admin force 可搶未逾時鎖；原持有者心跳回傳 false 作為降級依據", async () => {
    const { alice, admin, page } = await makeFixture();
    await acquireLock(page.id, alice.id);
    // 一般（非 force）取鎖在未逾時時失敗
    expect(await acquireLock(page.id, admin.id)).toBe(false);
    // force 搶鎖成功
    expect(await acquireLock(page.id, admin.id, { force: true })).toBe(true);
    const state = await getLockState(page.id, alice.id);
    expect(state.lockedBy).toBe(admin.id);
    expect(state.lockedByName).toBe(admin.name);
    // 原持有者 Alice 心跳失敗 → 前端據此降級唯讀
    expect(await heartbeatLock(page.id, alice.id)).toBe(false);
  });
});

describe("releaseLock（僅持有者可釋放）", () => {
  it("非持有者釋放不清鎖，持有者釋放後鎖清空", async () => {
    const { alice, bob, page } = await makeFixture();
    await acquireLock(page.id, alice.id);
    await releaseLock(page.id, bob.id);
    expect((await getLockState(page.id, alice.id)).lockedBy).toBe(alice.id);
    await releaseLock(page.id, alice.id);
    expect((await getLockState(page.id, alice.id)).lockedBy).toBeNull();
  });
});
