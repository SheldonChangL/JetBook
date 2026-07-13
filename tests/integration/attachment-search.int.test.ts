import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { searchAttachmentsByName } from "@/lib/search/attachments";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/** M4-04 附件檔名搜尋整合測試（真 PG）：檔名比對＋權限兩向（授權可見、無權絕不可見）。 */

async function seedAttachment(spaceId: string, pageId: string | null, fileName: string) {
  const [row] = await db
    .insert(attachments)
    .values({
      spaceId,
      pageId,
      fileName,
      mimeType: "application/pdf",
      sizeBytes: 12345,
      storageKey: `it-${randomUUID()}.pdf`,
      sha256: randomUUID().replaceAll("-", ""),
    })
    .returning();
  if (!row) throw new Error("seedAttachment failed");
  return row;
}

describe("searchAttachmentsByName（M4-04，issue #195）", () => {
  it("以檔名子字串（不分大小寫）命中，回傳所屬頁面資訊", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const page = await seedPage(space.id, { title: "規格頁" });
    const marker = randomUUID().slice(0, 8);
    const hit = await seedAttachment(space.id, page.id, `JB-1024-${marker}-規格書.PDF`);
    await seedAttachment(space.id, page.id, `無關檔案-${randomUUID().slice(0, 8)}.pdf`);

    const reader = await seedUser();
    const hits = await searchAttachmentsByName(reader, `${marker}-規格`);
    expect(hits.map((h) => h.id)).toEqual([hit.id]);
    expect(hits[0]).toMatchObject({
      fileName: hit.fileName,
      pageSlug: page.slug,
      spaceSlug: space.slug,
    });
  });

  it("私有空間的附件對非成員絕不可見；成員可見", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id);
    const marker = randomUUID().slice(0, 8);
    await seedAttachment(space.id, page.id, `機密-${marker}.pdf`);

    const outsider = await seedUser();
    expect(await searchAttachmentsByName(outsider, marker)).toEqual([]);

    // 加入成員後可見（seedSpace 不自動掛 creator 為成員）
    const member = await seedUser();
    await addMember(space.id, member.id, "viewer");
    const memberHits = await searchAttachmentsByName(member, marker);
    expect(memberHits).toHaveLength(1);
  });

  it("無頁面歸屬（pageId null，GC 寬限中孤兒）不入結果", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const marker = randomUUID().slice(0, 8);
    await seedAttachment(space.id, null, `孤兒-${marker}.pdf`);

    expect(await searchAttachmentsByName(owner, marker)).toEqual([]);
  });

  it("LIKE 萬用字元視為字面值", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read" });
    const page = await seedPage(space.id);
    const marker = randomUUID().slice(0, 8);
    await seedAttachment(space.id, page.id, `${marker}-100%.pdf`);
    await seedAttachment(space.id, page.id, `${marker}-100x.pdf`);

    const hits = await searchAttachmentsByName(owner, `${marker}-100%`);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.fileName).toBe(`${marker}-100%.pdf`);
  });
});
