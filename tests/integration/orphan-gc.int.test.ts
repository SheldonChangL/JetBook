import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { attachments, auditLogs, pages } from "@/lib/db/schema";
import { getStorageProvider } from "@/lib/storage/provider";
import {
  ORPHAN_ATTACHMENT_GRACE_DAYS,
  collectOrphanAttachments,
  findOrphanAttachments,
} from "@/lib/storage/gc";
import { getStorageUsage } from "@/lib/storage/usage";
import { seedSpace, seedUser } from "./helpers";

/**
 * M-03 孤兒附件 GC 整合測試（真 PG＋真 StorageProvider，N-01）。涵蓋：
 * - 逾寬限期且未被引用的孤兒：實體檔與 metadata 列皆被清除，並寫入稽核
 * - 被引用者不動：image src 與 attachment 節點兩種引用格式皆保護附件
 * - 寬限期內未引用者不回收（避免誤刪剛上傳、尚未存進內容的檔案）
 * - 被刪（軟刪）頁面的附件同判為孤兒（其內容不計入引用）
 * - 儲存用量統計（全站／各 Space 附件數與大小、孤兒待回收數）
 */

const storage = getStorageProvider();

/** 建立一筆真實附件（實體檔＋DB 列）；ageDays 回填 created_at 以模擬寬限期。 */
async function seedAttachment(opts: {
  spaceId: string;
  pageId?: string | null;
  ageDays: number;
  bytes?: number;
}) {
  const payload = Buffer.from(`orphan-gc-${randomUUID()}`);
  const storageKey = `it-gc-${randomUUID()}.bin`;
  await storage.put(storageKey, payload);
  const [row] = await db
    .insert(attachments)
    .values({
      spaceId: opts.spaceId,
      pageId: opts.pageId ?? null,
      fileName: "file.bin",
      mimeType: "application/octet-stream",
      sizeBytes: opts.bytes ?? payload.byteLength,
      storageKey,
      sha256: createHash("sha256").update(payload).digest("hex"),
    })
    .returning();
  if (!row) throw new Error("seedAttachment failed");
  const createdAt = new Date(Date.now() - opts.ageDays * 86_400_000);
  await db.update(attachments).set({ createdAt }).where(eq(attachments.id, row.id));
  return { ...row, createdAt };
}

/** 建立一頁並指定 TipTap content（jsonb）；deletedAt 非 null 即模擬軟刪。 */
async function seedPageWithContent(
  spaceId: string,
  content: unknown,
  opts: { deletedAt?: Date } = {},
) {
  const [page] = await db
    .insert(pages)
    .values({
      spaceId,
      slug: `it-gc-${randomUUID().slice(0, 8)}`,
      title: "GC 測試頁",
      content: content as never,
      position: "a0",
      deletedAt: opts.deletedAt ?? null,
    })
    .returning();
  if (!page) throw new Error("seedPageWithContent failed");
  return page;
}

function imageDoc(attachmentId: string) {
  return { type: "doc", content: [{ type: "image", attrs: { src: `/api/files/${attachmentId}` } }] };
}

function attachmentDoc(attachmentId: string) {
  return {
    type: "doc",
    content: [{ type: "attachment", attrs: { attachmentId, fileName: "a.pdf", sizeBytes: 1 } }],
  };
}

async function attachmentExists(id: string): Promise<boolean> {
  const row = await db.query.attachments.findFirst({ where: eq(attachments.id, id) });
  return row !== undefined;
}

async function fileExists(storageKey: string): Promise<boolean> {
  try {
    const stream = await storage.getStream(storageKey);
    stream.destroy();
    return true;
  } catch {
    return false;
  }
}

const OLD = ORPHAN_ATTACHMENT_GRACE_DAYS + 1;
const RECENT = ORPHAN_ATTACHMENT_GRACE_DAYS - 1;

describe("collectOrphanAttachments（回收孤兒附件）", () => {
  it("逾寬限期且未被引用：實體檔與 DB 列皆清除，並寫入稽核", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    // pageId=null（已刪頁面留下），無任何頁面內容引用，建立逾寬限期 → 孤兒
    const orphan = await seedAttachment({ spaceId: space.id, pageId: null, ageDays: OLD });

    expect(await fileExists(orphan.storageKey)).toBe(true);

    const result = await collectOrphanAttachments();
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    expect(await attachmentExists(orphan.id)).toBe(false);
    expect(await fileExists(orphan.storageKey)).toBe(false);

    const audit = await db.query.auditLogs.findFirst({
      where: eq(auditLogs.action, "attachment.gc_orphan"),
    });
    expect(audit).toBeDefined();
  });

  it("被引用者不動：image src 與 attachment 節點兩種引用皆保護附件", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const viaImage = await seedAttachment({ spaceId: space.id, ageDays: OLD });
    const viaNode = await seedAttachment({ spaceId: space.id, ageDays: OLD });

    await seedPageWithContent(space.id, imageDoc(viaImage.id));
    await seedPageWithContent(space.id, attachmentDoc(viaNode.id));

    await collectOrphanAttachments();

    expect(await attachmentExists(viaImage.id)).toBe(true);
    expect(await fileExists(viaImage.storageKey)).toBe(true);
    expect(await attachmentExists(viaNode.id)).toBe(true);
    expect(await fileExists(viaNode.storageKey)).toBe(true);
  });

  it("寬限期內的未引用附件不回收", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const recent = await seedAttachment({ spaceId: space.id, pageId: null, ageDays: RECENT });

    await collectOrphanAttachments();

    expect(await attachmentExists(recent.id)).toBe(true);
    expect(await fileExists(recent.storageKey)).toBe(true);
  });

  it("被刪（軟刪）頁面的附件同判為孤兒：其內容不計入引用", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const att = await seedAttachment({ spaceId: space.id, ageDays: OLD });
    // 引用只存在於一個軟刪頁面 → 不計入引用 → 逾寬限期即孤兒
    await seedPageWithContent(space.id, attachmentDoc(att.id), { deletedAt: new Date() });

    await collectOrphanAttachments();

    expect(await attachmentExists(att.id)).toBe(false);
    expect(await fileExists(att.storageKey)).toBe(false);
  });
});

describe("findOrphanAttachments / getStorageUsage（用量統計）", () => {
  it("孤兒清單只含逾寬限期未引用者；用量卡片彙總各 Space 數量與大小", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });

    // 4 筆：referenced(image)、referenced(node)、orphan(old)、recent(unreferenced)
    const refImg = await seedAttachment({ spaceId: space.id, ageDays: OLD, bytes: 100 });
    const refNode = await seedAttachment({ spaceId: space.id, ageDays: OLD, bytes: 200 });
    const orphan = await seedAttachment({ spaceId: space.id, pageId: null, ageDays: OLD, bytes: 400 });
    const recent = await seedAttachment({ spaceId: space.id, pageId: null, ageDays: RECENT, bytes: 800 });
    await seedPageWithContent(space.id, imageDoc(refImg.id));
    await seedPageWithContent(space.id, attachmentDoc(refNode.id));

    const orphans = await findOrphanAttachments();
    const thisSpaceOrphanIds = orphans.filter((o) => o.spaceId === space.id).map((o) => o.id).sort();
    // 只有 old 且未引用者是孤兒；referenced 與 recent 皆不在
    expect(thisSpaceOrphanIds).toEqual([orphan.id]);
    expect(thisSpaceOrphanIds).not.toContain(refImg.id);
    expect(thisSpaceOrphanIds).not.toContain(recent.id);

    const usage = await getStorageUsage();
    const spaceUsage = usage.perSpace.find((s) => s.spaceId === space.id);
    expect(spaceUsage).toBeDefined();
    expect(spaceUsage?.count).toBe(4);
    expect(spaceUsage?.bytes).toBe(100 + 200 + 400 + 800);
    // 全站彙總涵蓋本 Space（其他測試資料亦計入，故用 >=）
    expect(usage.totalCount).toBeGreaterThanOrEqual(4);
    expect(usage.orphanCount).toBeGreaterThanOrEqual(1);
    expect(usage.orphanBytes).toBeGreaterThanOrEqual(400);

    // 不呼叫回收：此測試僅驗統計，保留資料不污染其他測試的全域掃描
    expect(await attachmentExists(orphan.id)).toBe(true);
  });
});
