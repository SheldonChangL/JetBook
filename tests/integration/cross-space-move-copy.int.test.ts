import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { attachments, pages, pageVersions } from "@/lib/db/schema";
import { can } from "@/lib/authz/permission";
import { copyPageSubtreeToSpace, movePageSubtreeToSpace } from "@/lib/pages/cross-space";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * C-10 頁面跨 Space 移動／複製整合測試（真 PG，N-01；F-PAGE-05 + G6）。涵蓋：
 * - movePageSubtreeToSpace：整支子樹 space_id 轉移、根頁改掛根層、附件 space_id 同步轉移、
 *   附件下載權限（can page.read）即刻跟隨新 space（新 space 成員得讀、原 space 成員失讀）；
 *   目標 space slug 撞名時重生成、版本歷史（page_versions）仍與頁面 id 相連。
 * - copyPageSubtreeToSpace：深拷貝新 id、內容經儲存管線同步衍生欄位並產生版本快照、
 *   父子關係重建、原子樹不受影響。
 */

const DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "跨空間內容測試" }] }],
};

async function seedAttachment(spaceId: string, pageId: string, uploaderId: string, fileName = "a.pdf") {
  const [row] = await db
    .insert(attachments)
    .values({
      spaceId,
      pageId,
      uploaderId,
      fileName,
      mimeType: "application/pdf",
      sizeBytes: 1234,
      storageKey: `${randomUUID()}.pdf`,
      sha256: randomUUID().replace(/-/g, ""),
    })
    .returning();
  if (!row) throw new Error("seedAttachment failed");
  return row;
}

describe("movePageSubtreeToSpace（跨 space 搬移子樹 + 附件歸屬轉移 G6）", () => {
  it("整支子樹 space_id 轉移、根頁改掛根層、附件 space_id 同步轉移", async () => {
    const owner = await seedUser();
    const source = await seedSpace(owner.id, { visibility: "private" });
    const target = await seedSpace(owner.id, { visibility: "private" });
    await addMember(source.id, owner.id, "editor");
    await addMember(target.id, owner.id, "editor");

    const root = await seedPage(source.id, { title: "根頁", createdBy: owner.id });
    const child = await seedPage(source.id, { title: "子頁", parentId: root.id, createdBy: owner.id });
    const grandchild = await seedPage(source.id, {
      title: "孫頁",
      parentId: child.id,
      createdBy: owner.id,
    });
    const att = await seedAttachment(source.id, child.id, owner.id);

    const result = await movePageSubtreeToSpace({
      pageId: root.id,
      targetSpaceId: target.id,
      movedBy: owner.id,
    });

    expect(new Set(result.movedPageIds)).toEqual(new Set([root.id, child.id, grandchild.id]));

    const rows = await db
      .select({ id: pages.id, spaceId: pages.spaceId, parentId: pages.parentId })
      .from(pages)
      .where(inArray(pages.id, [root.id, child.id, grandchild.id]));
    for (const r of rows) expect(r.spaceId).toBe(target.id);
    // 根頁改掛目標根層（原父留在來源 space，不可跨 space 引用）；子孫維持原父。
    expect(rows.find((r) => r.id === root.id)?.parentId).toBeNull();
    expect(rows.find((r) => r.id === child.id)?.parentId).toBe(root.id);
    expect(rows.find((r) => r.id === grandchild.id)?.parentId).toBe(child.id);

    // 附件歸屬（G6）：space_id 同步改指目的地 space。
    const movedAtt = await db.query.attachments.findFirst({ where: eq(attachments.id, att.id) });
    expect(movedAtt?.spaceId).toBe(target.id);
  });

  it("附件下載權限（page.read）即刻跟隨新 space：新 space 成員得讀、原 space 成員失讀", async () => {
    const owner = await seedUser();
    // 只屬於目標 space 的使用者（不是來源成員）
    const targetOnly = await seedUser();
    // 只屬於來源 space 的使用者（不是目標成員）
    const sourceOnly = await seedUser();
    const source = await seedSpace(owner.id, { visibility: "private" });
    const target = await seedSpace(owner.id, { visibility: "private" });
    await addMember(source.id, owner.id, "editor");
    await addMember(target.id, owner.id, "editor");
    await addMember(source.id, sourceOnly.id, "viewer");
    await addMember(target.id, targetOnly.id, "viewer");

    const page = await seedPage(source.id, { title: "附件頁", createdBy: owner.id });
    const att = await seedAttachment(source.id, page.id, owner.id);

    // 搬移前：附件在來源 private space——來源成員可讀、目標成員不可讀。
    expect(await can(sourceOnly, "page.read", { type: "page", spaceId: att.spaceId })).toBe(true);
    expect(await can(targetOnly, "page.read", { type: "page", spaceId: att.spaceId })).toBe(false);

    await movePageSubtreeToSpace({ pageId: page.id, targetSpaceId: target.id, movedBy: owner.id });

    // 搬移後：附件 space 歸屬已轉移——下載 route 的 page.read 檢查即刻跟隨新 space。
    const moved = await db.query.attachments.findFirst({ where: eq(attachments.id, att.id) });
    expect(moved?.spaceId).toBe(target.id);
    expect(await can(targetOnly, "page.read", { type: "page", spaceId: moved!.spaceId })).toBe(true);
    // 原 space 成員（非目標成員）自此無法讀取該附件——權限確實跟隨、不留舊 space 後門。
    expect(await can(sourceOnly, "page.read", { type: "page", spaceId: moved!.spaceId })).toBe(false);
  });

  it("目標 space slug 撞名時重生成；未撞名的子頁沿用原 slug；版本歷史仍與頁面相連", async () => {
    const owner = await seedUser();
    const source = await seedSpace(owner.id, { visibility: "private" });
    const target = await seedSpace(owner.id, { visibility: "private" });
    await addMember(source.id, owner.id, "editor");
    await addMember(target.id, owner.id, "editor");

    const root = await seedPage(source.id, { title: "撞名根頁", createdBy: owner.id });
    const child = await seedPage(source.id, { title: "子頁", parentId: root.id, createdBy: owner.id });
    const originalRootSlug = root.slug;
    // 版本歷史：先塞一筆 page_versions（模擬既有快照），驗證搬移後仍相連。
    await db.insert(pageVersions).values({
      pageId: root.id,
      versionNo: 1,
      title: root.title,
      contentMd: "v1",
      createdBy: owner.id,
    });
    // 目標 space 內先建一頁佔用與來源根頁相同的 slug → 觸發搬移時重生成。
    await db.insert(pages).values({
      spaceId: target.id,
      slug: originalRootSlug,
      title: "目標既有頁",
      position: "a0",
      createdBy: owner.id,
      updatedBy: owner.id,
    });

    await movePageSubtreeToSpace({ pageId: root.id, targetSpaceId: target.id, movedBy: owner.id });

    const movedRoot = await db.query.pages.findFirst({ where: eq(pages.id, root.id) });
    const movedChild = await db.query.pages.findFirst({ where: eq(pages.id, child.id) });
    expect(movedRoot?.spaceId).toBe(target.id);
    // 撞名根頁 slug 重生成，與既有佔用者不同、且目標 space 內唯一。
    expect(movedRoot?.slug).not.toBe(originalRootSlug);
    const sameSlug = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.spaceId, target.id), eq(pages.slug, movedRoot!.slug)));
    expect(sameSlug).toHaveLength(1);
    // 未撞名的子頁沿用原 slug。
    expect(movedChild?.slug).toBe(child.slug);
    // 版本歷史依 page_id 相連，搬移不影響。
    const versions = await db
      .select({ versionNo: pageVersions.versionNo })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, root.id));
    expect(versions.length).toBeGreaterThanOrEqual(1);
  });
});

describe("copyPageSubtreeToSpace（跨 space 深拷貝）", () => {
  it("深拷貝新 id、內容經儲存管線同步衍生欄位並產生版本、原子樹不受影響", async () => {
    const owner = await seedUser();
    const source = await seedSpace(owner.id, { visibility: "private" });
    const target = await seedSpace(owner.id, { visibility: "private" });
    await addMember(source.id, owner.id, "editor");
    await addMember(target.id, owner.id, "editor");

    const root = await seedPage(source.id, { title: "來源根頁", createdBy: owner.id });
    const child = await seedPage(source.id, { title: "來源子頁", parentId: root.id, createdBy: owner.id });
    // 給根頁塞內容（jsonb）供拷貝＋衍生驗證。
    await db.update(pages).set({ content: DOC }).where(eq(pages.id, root.id));

    const result = await copyPageSubtreeToSpace({
      pageId: root.id,
      targetSpaceId: target.id,
      userId: owner.id,
    });

    expect(result.copiedPageIds).toHaveLength(2);
    // 新頁為全新 id（與來源不同）。
    expect(result.copiedPageIds).not.toContain(root.id);
    expect(result.copiedPageIds).not.toContain(child.id);

    // 目標 space 內建出兩頁：根頁（parent null）＋子頁（掛在複製根頁下）。
    const newRoot = await db.query.pages.findFirst({ where: eq(pages.id, result.newRootId) });
    expect(newRoot?.spaceId).toBe(target.id);
    expect(newRoot?.parentId).toBeNull();
    expect(newRoot?.title).toBe("來源根頁");
    // 內容經 writePageContentTx 管線：三欄同步（content_md / content_text 衍生非空）＋版本遞增。
    expect(newRoot?.contentMd).toContain("跨空間內容測試");
    expect(newRoot?.contentText).toContain("跨空間內容測試");
    expect(newRoot?.currentVersionNo).toBe(1);

    const newChild = await db.query.pages.findFirst({
      where: and(eq(pages.spaceId, target.id), eq(pages.parentId, result.newRootId)),
    });
    expect(newChild?.title).toBe("來源子頁");

    // 版本快照落地（新頁 versionNo=1）。
    const rootVersions = await db
      .select({ versionNo: pageVersions.versionNo })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, result.newRootId));
    expect(rootVersions.map((v) => v.versionNo)).toContain(1);

    // 原子樹不受影響：來源頁 space 未變、內容仍在。
    const srcRoot = await db.query.pages.findFirst({ where: eq(pages.id, root.id) });
    expect(srcRoot?.spaceId).toBe(source.id);
  });
});
