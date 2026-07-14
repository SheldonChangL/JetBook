import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { resolveAttachmentPreview } from "@/lib/storage/preview";
import { seedPage, seedSpace, seedUser } from "./helpers";

/**
 * M4-11 PDF 附件預覽決策層整合測試（真 PG，issue #215）：
 * 僅 PDF 可 inline（副檔名＋MIME 雙比對）、權限 page.read、不存在 404 防枚舉。
 * route 薄殼（session/streaming/headers）由瀏覽器實測驗證。
 */

async function seedAttachment(
  spaceId: string,
  pageId: string,
  overrides: { fileName?: string; mimeType?: string } = {},
) {
  const [att] = await db
    .insert(attachments)
    .values({
      pageId,
      spaceId,
      fileName: overrides.fileName ?? "doc.pdf",
      mimeType: overrides.mimeType ?? "application/pdf",
      sizeBytes: 3,
      storageKey: `it-${randomUUID()}.bin`,
      sha256: "x",
    })
    .returning();
  return att!;
}

describe("PDF 附件預覽決策（M4-11，issue #215）", () => {
  it("PDF 附件＋有讀取權 → ok", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const page = await seedPage(space.id);
    const att = await seedAttachment(space.id, page.id);

    const reader = await seedUser();
    const result = await resolveAttachmentPreview(reader, att.id);
    expect(result.ok).toBe(true);
  });

  it("私有空間外人 → 403（與下載端點同權限模型）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id);
    const att = await seedAttachment(space.id, page.id);

    const outsider = await seedUser();
    const result = await resolveAttachmentPreview(outsider, att.id);
    expect(result).toEqual({ ok: false, status: 403 });
  });

  it("非 PDF 附件（docx）→ 404；MIME 竄改為 pdf 但副檔名非 pdf → 404", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const page = await seedPage(space.id);
    const docx = await seedAttachment(space.id, page.id, {
      fileName: "spec.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const forged = await seedAttachment(space.id, page.id, {
      fileName: "evil.docx",
      mimeType: "application/pdf",
    });
    const forgedExt = await seedAttachment(space.id, page.id, {
      fileName: "fake.pdf",
      mimeType: "text/html",
    });

    const reader = await seedUser();
    expect(await resolveAttachmentPreview(reader, docx.id)).toEqual({ ok: false, status: 404 });
    expect(await resolveAttachmentPreview(reader, forged.id)).toEqual({ ok: false, status: 404 });
    expect(await resolveAttachmentPreview(reader, forgedExt.id)).toEqual({ ok: false, status: 404 });
  });

  it("不存在／非 UUID → 404", async () => {
    const reader = await seedUser();
    expect(await resolveAttachmentPreview(reader, randomUUID())).toEqual({ ok: false, status: 404 });
    expect(await resolveAttachmentPreview(reader, "not-a-uuid")).toEqual({ ok: false, status: 404 });
  });
});
