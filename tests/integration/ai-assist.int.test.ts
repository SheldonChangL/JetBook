import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { canEditPage } from "@/lib/authz/permission";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * I-08 寫作輔助權限整合測試（真 PG）：/api/ai/assist 只允許對「有編輯權」的頁面使用，
 * 權限一律經 authz 唯一入口 canEditPage（page.edit，預設拒絕）。
 */

describe("canEditPage（寫作輔助 API 權限把關）", () => {
  it("private space：editor 可、viewer 與非成員不可", async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const viewer = await seedUser();
    const stranger = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, editor.id, "editor");
    await addMember(space.id, viewer.id, "viewer");
    const page = await seedPage(space.id);

    expect(await canEditPage(editor, page.id)).toBe(true);
    expect(await canEditPage(viewer, page.id)).toBe(false);
    expect(await canEditPage(stranger, page.id)).toBe(false);
  });

  it("org_write space：非成員經 visibility 隱含 editor 亦可編輯", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_write" });
    const page = await seedPage(space.id);

    expect(await canEditPage(stranger, page.id)).toBe(true);
  });

  it("org_read space：非成員只讀，不可編輯", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const page = await seedPage(space.id);

    expect(await canEditPage(stranger, page.id)).toBe(false);
  });

  it("org admin 對任何頁面皆可編輯", async () => {
    const owner = await seedUser();
    const orgAdmin = await seedUser({ orgRole: "admin" });
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id);

    expect(await canEditPage(orgAdmin, page.id)).toBe(true);
  });

  it("軟刪除頁面：即使有 space 編輯權也不可編輯", async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, editor.id, "editor");
    const page = await seedPage(space.id);
    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, page.id));

    expect(await canEditPage(editor, page.id)).toBe(false);
  });

  it("不存在的頁面回 false（不洩漏存在性）", async () => {
    const user = await seedUser();
    expect(await canEditPage(user, "00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});
