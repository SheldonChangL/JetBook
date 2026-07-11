import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { attachments, auditLogs, pages, pageVersions } from "@/lib/db/schema";
import { getAccessiblePageIds, getEditableSpaceIds } from "@/lib/authz/permission";
import {
  listTrashItems,
  purgeExpiredTrash,
  restoreTrashPage,
  TRASH_RETENTION_DAYS,
} from "@/lib/pages/trash";
import { fullTextSearch } from "@/lib/search/fulltext";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * C-08 回收桶整合測試（真 PG，N-01）。涵蓋：
 * - 批次頂節點列表 + 刪除者解析（audit_logs）+ 同批子頁計數
 * - 還原同批子樹（原父存活回原位；原父已刪掛回最上層；較早刪除的後代留桶）
 * - 逾期永久清除（FK cascade 版本、attachments 置 null、保留近期）
 * - 權限：getEditableSpaceIds 僅含 editor+；回收桶內容不進搜尋（getAccessiblePageIds/pgroonga）
 */

/** 複製 deletePage 的軟刪語意：整支子樹於同一時間戳進回收桶，並記一筆 page.delete 稽核。 */
async function softDeleteSubtree(rootId: string, deleterId: string, when: Date = new Date()) {
  await db.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM pages WHERE id = ${rootId}
      UNION ALL
      SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id
    )
    UPDATE pages SET deleted_at = ${when}
    WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL
  `);
  await db.insert(auditLogs).values({
    actorId: deleterId,
    action: "page.delete",
    targetType: "page",
    targetId: rootId,
  });
  return when;
}

async function getPage(id: string) {
  return db.query.pages.findFirst({ where: eq(pages.id, id) });
}

describe("listTrashItems（批次頂節點 + 刪除者 + 子頁數）", () => {
  it("僅列出每批頂節點，計入同批後代並解析刪除者", async () => {
    const owner = await seedUser({ name: "刪除者甲" });
    const space = await seedSpace(owner.id, { visibility: "private" });
    await addMember(space.id, owner.id, "editor");

    const a = await seedPage(space.id, { title: "父頁 A" });
    const b = await seedPage(space.id, { title: "子頁 B", parentId: a.id });
    await seedPage(space.id, { title: "孫頁 C", parentId: b.id });
    const d = await seedPage(space.id, { title: "另一根頁 D" });

    await softDeleteSubtree(a.id, owner.id);

    const items = await listTrashItems([space.id]);
    const ids = items.map((i) => i.pageId);
    expect(ids).toContain(a.id);
    // 後代不單獨成列（B、C 屬 A 的同批子樹）；D 未刪不列
    expect(ids).not.toContain(b.id);
    expect(ids).not.toContain(d.id);

    const rootA = items.find((i) => i.pageId === a.id)!;
    expect(rootA.descendantCount).toBe(2);
    expect(rootA.deleterName).toBe("刪除者甲");
    expect(rootA.spaceSlug).toBe(space.slug);
  });
});

describe("restoreTrashPage（還原語意）", () => {
  it("原父存活：還原整支同批子樹回原位置", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const parent = await seedPage(space.id, { title: "存活父頁" });
    const child = await seedPage(space.id, { title: "被刪子頁", parentId: parent.id });
    const grand = await seedPage(space.id, { title: "被刪孫頁", parentId: child.id });

    await softDeleteSubtree(child.id, owner.id);
    // 刪除後不可讀
    expect(await getAccessiblePageIds(owner)).not.toContain(child.id);

    const res = await restoreTrashPage({ pageId: child.id, userId: owner.id });
    expect(res.reparentedToRoot).toBe(false);

    expect((await getPage(child.id))?.deletedAt).toBeNull();
    expect((await getPage(grand.id))?.deletedAt).toBeNull();
    // 原父仍為 parent（回原位）
    expect((await getPage(child.id))?.parentId).toBe(parent.id);
    // 還原後恢復可讀（＝重新進搜尋/RAG 範圍）
    const readable = await getAccessiblePageIds(owner);
    expect(readable).toContain(child.id);
    expect(readable).toContain(grand.id);
  });

  it("原父已刪：還原後掛回最上層（parent_id=null）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const parent = await seedPage(space.id, { title: "父頁" });
    const child = await seedPage(space.id, { title: "子頁", parentId: parent.id });

    // 先刪子頁（批 t1），再刪父頁（批 t2）——兩批不同
    const t1 = new Date(Date.now() - 2 * 86_400_000);
    const t2 = new Date(Date.now() - 1 * 86_400_000);
    await softDeleteSubtree(child.id, owner.id, t1);
    await softDeleteSubtree(parent.id, owner.id, t2);

    const res = await restoreTrashPage({ pageId: child.id, userId: owner.id });
    expect(res.reparentedToRoot).toBe(true);

    const restored = await getPage(child.id);
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.parentId).toBeNull();
    // 父頁仍在回收桶
    expect((await getPage(parent.id))?.deletedAt).not.toBeNull();
  });

  it("只還原同批：較早刪除的後代仍留在回收桶", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const a = await seedPage(space.id, { title: "A" });
    const b = await seedPage(space.id, { title: "B", parentId: a.id });
    const c = await seedPage(space.id, { title: "C", parentId: b.id });

    const tEarly = new Date(Date.now() - 3 * 86_400_000);
    const tLate = new Date(Date.now() - 1 * 86_400_000);
    // 先刪 C（批 tEarly），再刪 A（批 tLate：A、B 進桶，C 維持 tEarly）
    await softDeleteSubtree(c.id, owner.id, tEarly);
    await softDeleteSubtree(a.id, owner.id, tLate);

    // A 批子樹只含 A、B（descendantCount=1）；C 自成一列
    const items = await listTrashItems([space.id]);
    const rootA = items.find((i) => i.pageId === a.id)!;
    expect(rootA.descendantCount).toBe(1);
    expect(items.map((i) => i.pageId)).toContain(c.id);

    await restoreTrashPage({ pageId: a.id, userId: owner.id });
    expect((await getPage(a.id))?.deletedAt).toBeNull();
    expect((await getPage(b.id))?.deletedAt).toBeNull();
    // C 屬較早批，未被還原
    expect((await getPage(c.id))?.deletedAt).not.toBeNull();
  });
});

describe("purgeExpiredTrash（逾期永久清除）", () => {
  it("硬刪逾 30 天頁面、級聯版本、attachments 置 null，保留近期", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const expired = await seedPage(space.id, { title: "逾期頁" });
    const recent = await seedPage(space.id, { title: "近期刪除頁" });

    // 版本與附件掛在逾期頁上，驗證級聯與置 null
    await db.insert(pageVersions).values({
      pageId: expired.id,
      versionNo: 1,
      title: "逾期頁",
      contentMd: "",
    });
    const [att] = await db
      .insert(attachments)
      .values({
        pageId: expired.id,
        spaceId: space.id,
        fileName: "f.png",
        mimeType: "image/png",
        sizeBytes: 1,
        storageKey: `it-trash-${expired.id}`,
        sha256: "0".repeat(64),
      })
      .returning();

    const overRetention = new Date(Date.now() - (TRASH_RETENTION_DAYS + 1) * 86_400_000);
    await softDeleteSubtree(expired.id, owner.id, overRetention);
    await softDeleteSubtree(recent.id, owner.id, new Date());

    const purged = await purgeExpiredTrash();
    expect(purged).toBeGreaterThanOrEqual(1);

    expect(await getPage(expired.id)).toBeUndefined();
    // 版本級聯刪除
    const versions = await db.query.pageVersions.findFirst({
      where: eq(pageVersions.pageId, expired.id),
    });
    expect(versions).toBeUndefined();
    // 附件保留但 page_id 置 null
    const keptAtt = await db.query.attachments.findFirst({ where: eq(attachments.id, att!.id) });
    expect(keptAtt).toBeDefined();
    expect(keptAtt?.pageId).toBeNull();
    // 近期刪除頁不受影響
    expect(await getPage(recent.id)).toBeDefined();
  });
});

describe("權限：getEditableSpaceIds 與搜尋排除", () => {
  it("僅含 editor+ 的 space（org_write 隱含 editor；viewer 不含）", async () => {
    const member = await seedUser();
    const editorSpace = await seedSpace(member.id, { visibility: "private" });
    await addMember(editorSpace.id, member.id, "editor");
    const viewerSpace = await seedSpace(member.id, { visibility: "private" });
    await addMember(viewerSpace.id, member.id, "viewer");
    const orgWrite = await seedSpace(member.id, { visibility: "org_write" });
    const orgRead = await seedSpace(member.id, { visibility: "org_read" });

    const stranger = await seedUser();
    const ids = await getEditableSpaceIds(stranger);
    expect(ids).toContain(orgWrite.id); // 隱含 editor
    expect(ids).not.toContain(orgRead.id); // 隱含 viewer
    expect(ids).not.toContain(editorSpace.id); // 非成員 private
    expect(ids).not.toContain(viewerSpace.id);

    const memberIds = await getEditableSpaceIds(member);
    expect(memberIds).toContain(editorSpace.id); // 成員 editor
    expect(memberIds).not.toContain(viewerSpace.id); // 成員 viewer 不可還原
  });

  it("org admin 對所有 space 皆可還原", async () => {
    const owner = await seedUser();
    const admin = await seedUser({ orgRole: "admin" });
    const priv = await seedSpace(owner.id, { visibility: "private" });
    expect(await getEditableSpaceIds(admin)).toContain(priv.id);
  });

  it("回收桶內容不進全文搜尋，還原後恢復（F-PAGE-06 驗收 2）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const token = `回收桶隔離${Date.now()}`;
    const page = await seedPage(space.id, { title: token, contentText: token });

    const before = await fullTextSearch(owner, token);
    expect(before.map((h) => h.pageId)).toContain(page.id);

    await softDeleteSubtree(page.id, owner.id);
    const during = await fullTextSearch(owner, token);
    expect(during.map((h) => h.pageId)).not.toContain(page.id);

    await restoreTrashPage({ pageId: page.id, userId: owner.id });
    const after = await fullTextSearch(owner, token);
    expect(after.map((h) => h.pageId)).toContain(page.id);
  });
});
