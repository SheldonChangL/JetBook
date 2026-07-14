import { createServer, type Server } from "node:http";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { attachmentPreviews, attachments } from "@/lib/db/schema";
import { convertAttachmentPreview } from "@/lib/storage/office-preview";
import { resolveAttachmentPreview } from "@/lib/storage/preview";
import { collectOrphanAttachments } from "@/lib/storage/gc";
import { getStorageProvider } from "@/lib/storage/provider";
import { seedPage, seedSpace, seedUser } from "./helpers";

/**
 * M4-12 Office 附件轉 PDF 預覽整合測試（真 PG＋假轉檔 HTTP server，issue #216）：
 * 轉檔 job 核心（成功/失敗）、預覽決策（ready/pending/failed/未啟用）、GC 衍生檔回收。
 * lazy 補排路徑（無列 → enqueue → 202）依賴 pg-boss 啟動，於瀏覽器實測驗證。
 */

const storage = getStorageProvider();
const FAKE_PDF = Buffer.from("%PDF-1.4\nfake office derived pdf\n%%EOF\n");

let okServer: Server;
let failServer: Server;
let okUrl = "";
let failUrl = "";

beforeAll(async () => {
  okServer = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end(FAKE_PDF);
  });
  failServer = createServer((_req, res) => {
    res.writeHead(500);
    res.end("boom");
  });
  await new Promise<void>((r) => okServer.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => failServer.listen(0, "127.0.0.1", r));
  okUrl = `http://127.0.0.1:${(okServer.address() as { port: number }).port}`;
  failUrl = `http://127.0.0.1:${(failServer.address() as { port: number }).port}`;
});

afterAll(async () => {
  okServer.close();
  failServer.close();
});

async function seedOfficeAttachment(spaceId: string, pageId: string | null) {
  const storageKey = `it-office-${randomUUID()}.docx`;
  await storage.put(storageKey, Buffer.from("fake docx bytes"));
  const [att] = await db
    .insert(attachments)
    .values({
      pageId,
      spaceId,
      fileName: "規格書.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 15,
      storageKey,
      sha256: "x",
    })
    .returning();
  return att!;
}

describe("Office 附件轉 PDF 預覽（M4-12，issue #216）", () => {
  it("轉檔成功 → 預覽列 ready、衍生 PDF 落地可讀", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const page = await seedPage(space.id);
    const att = await seedOfficeAttachment(space.id, page.id);

    await convertAttachmentPreview(att.id, okUrl);

    const row = await db.query.attachmentPreviews.findFirst({
      where: eq(attachmentPreviews.attachmentId, att.id),
    });
    expect(row?.status).toBe("ready");
    expect(row?.storageKey).toBeTruthy();
    expect(row?.sizeBytes).toBe(FAKE_PDF.length);
    // 衍生檔實際存在且為 PDF
    const stream = await storage.getStream(row!.storageKey!);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
    expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("轉檔服務 500 → 擲錯（pg-boss 重試）且預覽列 failed 帶 error", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const page = await seedPage(space.id);
    const att = await seedOfficeAttachment(space.id, page.id);

    await expect(convertAttachmentPreview(att.id, failUrl)).rejects.toThrow();
    const row = await db.query.attachmentPreviews.findFirst({
      where: eq(attachmentPreviews.attachmentId, att.id),
    });
    expect(row?.status).toBe("failed");
    expect(row?.error).toBeTruthy();
  });

  it("預覽決策：ready → 衍生 key；pending → 202；failed → 404；未啟用轉檔 → 404", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const page = await seedPage(space.id);
    const reader = await seedUser();

    const ready = await seedOfficeAttachment(space.id, page.id);
    await convertAttachmentPreview(ready.id, okUrl);
    const readyResult = await resolveAttachmentPreview(reader, ready.id, {
      converterConfigured: true,
    });
    expect(readyResult.ok).toBe(true);
    if (readyResult.ok) {
      expect(readyResult.storageKey).not.toBe(ready.storageKey);
      expect(readyResult.fileName.endsWith(".pdf")).toBe(true);
    }

    const pending = await seedOfficeAttachment(space.id, page.id);
    await db.insert(attachmentPreviews).values({ attachmentId: pending.id, status: "pending" });
    expect(
      await resolveAttachmentPreview(reader, pending.id, { converterConfigured: true }),
    ).toEqual({ ok: false, status: 202 });

    const failed = await seedOfficeAttachment(space.id, page.id);
    await db
      .insert(attachmentPreviews)
      .values({ attachmentId: failed.id, status: "failed", error: "boom" });
    expect(
      await resolveAttachmentPreview(reader, failed.id, { converterConfigured: true }),
    ).toEqual({ ok: false, status: 404 });

    // 轉檔服務未設定：Office 附件一律 404（不洩漏存在性、不誤發 202）
    expect(
      await resolveAttachmentPreview(reader, ready.id, { converterConfigured: false }),
    ).toEqual({ ok: false, status: 404 });
  });

  it("私有空間外人 → 403（權限先於衍生狀態）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id);
    const att = await seedOfficeAttachment(space.id, page.id);
    await convertAttachmentPreview(att.id, okUrl);

    const outsider = await seedUser();
    expect(
      await resolveAttachmentPreview(outsider, att.id, { converterConfigured: true }),
    ).toEqual({ ok: false, status: 403 });
  });

  it("孤兒附件 GC 連衍生 PDF 一併回收（列隨 FK cascade）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    // 孤兒：pageId null＋建立時間逾寬限期
    const att = await seedOfficeAttachment(space.id, null);
    await db
      .update(attachments)
      .set({ createdAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(attachments.id, att.id));
    await convertAttachmentPreview(att.id, okUrl);
    const row = await db.query.attachmentPreviews.findFirst({
      where: eq(attachmentPreviews.attachmentId, att.id),
    });
    const derivedKey = row!.storageKey!;

    await collectOrphanAttachments();

    // 兩個實體檔都刪了；預覽列隨附件 cascade
    await expect(storage.getStream(att.storageKey)).rejects.toThrow();
    await expect(storage.getStream(derivedKey)).rejects.toThrow();
    expect(
      await db.query.attachments.findFirst({ where: eq(attachments.id, att.id) }),
    ).toBeUndefined();
    expect(
      await db.query.attachmentPreviews.findFirst({
        where: eq(attachmentPreviews.attachmentId, att.id),
      }),
    ).toBeUndefined();
  });
});
