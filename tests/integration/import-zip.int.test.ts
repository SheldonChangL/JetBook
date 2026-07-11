import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { db } from "@/lib/db";
import { attachments, pages, pageVersions } from "@/lib/db/schema";
import { getStorageProvider } from "@/lib/storage/provider";
import { runImportZip } from "@/lib/jobs/import-zip";
import type { ProseMirrorDoc, ProseMirrorNode } from "@/lib/content/types";
import { seedSpace, seedUser } from "./helpers";

/**
 * J-02 Zip 批次匯入整合測試（真 PG）。驗收：
 * - 構造巢狀 zip（資料夾 + md + 圖片）→ runImportZip → 樹結構／內容／圖片連結正確；
 *   內容走既有儲存管線（三欄同交易同步 + 版本快照），圖片上傳為附件並改寫為 /api/files/<id>。
 * - 惡意 zip（路徑穿越）被拒且不建任何頁面。
 * - 暫存 zip 用完即刪。
 *
 * embedding 端點未設定（測試 env）：triggerEmbed 略過，不觸及 pg-boss。
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

function makeZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    entries[name] = typeof value === "string" ? strToU8(value) : value;
  }
  return zipSync(entries);
}

/** 把 zip 放進 StorageProvider，回傳 storageKey。 */
async function stageZip(zip: Uint8Array): Promise<string> {
  const key = `import-test-${randomUUID()}.zip`;
  await getStorageProvider().put(key, Buffer.from(zip));
  return key;
}

/** 遞迴收集 doc 中所有 image 節點。 */
function collectImages(node: ProseMirrorNode | ProseMirrorDoc): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  const content = (node as ProseMirrorNode).content;
  for (const child of content ?? []) {
    if (child.type === "image") out.push(child);
    out.push(...collectImages(child));
  }
  return out;
}

describe("runImportZip（Zip 批次匯入 · 真 PG）", () => {
  it("巢狀資料夾 + md + 圖片：樹結構、內容、圖片連結正確", async () => {
    const user = await seedUser();
    const space = await seedSpace(user.id);

    const zip = makeZip({
      "guide/intro.md": "# 入門指南\n\n歡迎使用 JetBook。\n\n![架構圖](images/arch.png)",
      "guide/images/arch.png": PNG,
      "overview.md": "# 總覽\n\n這是總覽頁。",
    });
    const storageKey = await stageZip(zip);

    const report = await runImportZip({
      storageKey,
      fileName: "docs.zip",
      spaceId: space.id,
      parentId: null,
      userId: user.id,
    });

    expect(report.phase).toBe("completed");
    expect(report.createdPages).toBe(3); // 資料夾 guide + 頁面 intro + 頁面 overview
    expect(report.uploadedImages).toBe(1);
    expect(report.rewrittenImageLinks).toBe(1);
    expect(report.skipped).toEqual([]);

    const rows = await db
      .select()
      .from(pages)
      .where(and(eq(pages.spaceId, space.id), isNull(pages.deletedAt)));
    expect(rows).toHaveLength(3);

    const guide = rows.find((p) => p.title === "guide");
    const intro = rows.find((p) => p.title === "入門指南");
    const overview = rows.find((p) => p.title === "總覽");
    expect(guide).toBeDefined();
    expect(intro).toBeDefined();
    expect(overview).toBeDefined();

    // 資料夾＝父頁：guide 為根層，intro 掛在 guide 下，overview 為根層。
    expect(guide!.parentId).toBeNull();
    expect(intro!.parentId).toBe(guide!.id);
    expect(overview!.parentId).toBeNull();

    // 圖片上傳為附件（同 space），並改寫為 /api/files/<id>。
    const atts = await db.select().from(attachments).where(eq(attachments.spaceId, space.id));
    expect(atts).toHaveLength(1);
    expect(atts[0]!.fileName).toBe("arch.png");
    expect(atts[0]!.mimeType).toBe("image/png");

    const introDoc = intro!.content as ProseMirrorDoc;
    const images = collectImages(introDoc);
    expect(images).toHaveLength(1);
    expect(images[0]!.attrs).toEqual({ src: `/api/files/${atts[0]!.id}`, alt: "架構圖" });

    // 三欄同交易同步：content_md／content_text 落地；圖片連結亦入 md。
    expect(intro!.contentMd).toContain(`/api/files/${atts[0]!.id}`);
    expect(intro!.contentText).toContain("歡迎使用");
    // 內容頁走儲存管線 → 版本遞增至 1 並有版本快照；資料夾頁維持 0。
    expect(intro!.currentVersionNo).toBe(1);
    expect(guide!.currentVersionNo).toBe(0);
    const introVersions = await db
      .select()
      .from(pageVersions)
      .where(eq(pageVersions.pageId, intro!.id));
    expect(introVersions).toHaveLength(1);
    expect(introVersions[0]!.versionNo).toBe(1);

    // 暫存 zip 用完即刪。
    await expect(getStorageProvider().getStream(storageKey)).rejects.toThrow();
  });

  it("惡意 zip（路徑穿越）被拒，且不建任何頁面", async () => {
    const user = await seedUser();
    const space = await seedSpace(user.id);

    const zip = makeZip({
      "ok.md": "# 正常頁",
      "../../etc/evil.md": "malicious",
    });
    const storageKey = await stageZip(zip);

    const report = await runImportZip({
      storageKey,
      fileName: "evil.zip",
      spaceId: space.id,
      parentId: null,
      userId: user.id,
    });

    expect(report.phase).toBe("failed");
    expect(report.errorCode).toBe("PATH_TRAVERSAL");

    const rows = await db.select().from(pages).where(eq(pages.spaceId, space.id));
    expect(rows).toHaveLength(0);

    // 失敗路徑同樣刪除暫存 zip。
    await expect(getStorageProvider().getStream(storageKey)).rejects.toThrow();
  });

  it("匯入至指定父頁：所有根層節點掛在該父頁下", async () => {
    const user = await seedUser();
    const space = await seedSpace(user.id);
    // 既有父頁
    const [parent] = await db
      .insert(pages)
      .values({ spaceId: space.id, slug: `parent-${randomUUID().slice(0, 8)}`, title: "既有父頁", position: "a0" })
      .returning();

    const zip = makeZip({ "child.md": "# 子頁", "folder/nested.md": "# 巢狀" });
    const storageKey = await stageZip(zip);

    const report = await runImportZip({
      storageKey,
      fileName: "sub.zip",
      spaceId: space.id,
      parentId: parent!.id,
      userId: user.id,
    });
    expect(report.phase).toBe("completed");

    const child = await db.query.pages.findFirst({
      where: and(eq(pages.spaceId, space.id), eq(pages.title, "子頁")),
    });
    const folder = await db.query.pages.findFirst({
      where: and(eq(pages.spaceId, space.id), eq(pages.title, "folder")),
    });
    expect(child?.parentId).toBe(parent!.id);
    expect(folder?.parentId).toBe(parent!.id);
  });
});
