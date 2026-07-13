import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { db } from "@/lib/db";
import { attachments, pages } from "@/lib/db/schema";
import { getStorageProvider } from "@/lib/storage/provider";
import { createPageInTx } from "@/lib/pages/create";
import { writePageContentTx } from "@/lib/pages/content-write";
import { saveAttachment } from "@/lib/storage/upload";
import { runExportSpace, purgeExpiredExports, EXPORT_STORAGE_PREFIX } from "@/lib/jobs/export-space";
import { runImportZip } from "@/lib/jobs/import-zip";
import type { ProseMirrorDoc, ProseMirrorNode } from "@/lib/content/types";
import { seedSpace, seedUser } from "./helpers";

/**
 * J-03 整個 Space Markdown 匯出整合測試（真 PG）。驗收：
 * - 建立巢狀頁面樹（內容＋子頁＋站內圖片）→ runExportSpace → 解開 zip 目錄結構正確，
 *   資料夾頁自身內容寫入 README.md，圖片放入 assets/ 且 md 連結改寫為相對路徑。
 * - round-trip：把匯出的 zip 以 J-02 runImportZip 匯入新空間 → 標題／階層／圖片保留（F-IE-02）。
 * - 逾期匯出暫存檔由 purge 清除。
 *
 * embedding 端點未設定（測試 env）：triggerEmbed 略過，不觸及 pg-boss。
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** 走既有儲存管線建立一個帶內容的頁（三欄同交易同步）。 */
async function createPageWithContent(
  spaceId: string,
  parentId: string | null,
  title: string,
  doc: ProseMirrorDoc,
  userId: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const created = await createPageInTx(tx, { spaceId, parentId, title, userId });
    await writePageContentTx(tx, {
      pageId: created.id,
      pageTitle: created.title,
      expectedVersionNo: 0,
      content: doc,
      userId,
    });
    return created.id;
  });
}

function para(text: string): ProseMirrorNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

/** 遞迴收集 doc 中所有 image 節點。 */
function collectImages(node: ProseMirrorNode | ProseMirrorDoc): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  for (const child of (node as ProseMirrorNode).content ?? []) {
    if (child.type === "image") out.push(child);
    out.push(...collectImages(child));
  }
  return out;
}

describe("runExportSpace（整個 Space 匯出 · 真 PG）", () => {
  it("巢狀頁面樹＋圖片：zip 結構正確，且以 J-02 re-import 後標題／結構／圖片保留", async () => {
    const user = await seedUser();
    const space = await seedSpace(user.id, { name: "凱銳文件庫" });

    // 站內圖片附件（供內容引用）。
    const att = await saveAttachment({
      spaceId: space.id,
      pageId: null,
      uploaderId: user.id,
      fileName: "arch.png",
      mimeType: "image/png",
      data: Buffer.from(PNG),
    });

    // 頁面樹：指南（含內容＋圖片）> 安裝；總覽（根層葉頁）。
    const guideDoc: ProseMirrorDoc = {
      type: "doc",
      content: [para("歡迎使用 JetBook。"), { type: "image", attrs: { src: `/api/files/${att.id}`, alt: "架構圖" } }],
    };
    const guideId = await createPageWithContent(space.id, null, "指南", guideDoc, user.id);
    await createPageWithContent(space.id, guideId, "安裝", { type: "doc", content: [para("步驟一。")] }, user.id);
    await createPageWithContent(space.id, null, "總覽", { type: "doc", content: [para("概述。")] }, user.id);

    // 匯出。
    const exportJobId = randomUUID();
    const report = await runExportSpace(
      { spaceId: space.id, spaceName: space.name, userId: user.id },
      { jobId: exportJobId },
    );

    expect(report.phase).toBe("completed");
    expect(report.exportedPages).toBe(3);
    expect(report.includedAssets).toBe(1);
    expect(report.fileName).toBe("凱銳文件庫.zip");
    expect(report.storageKey).toBe(`${EXPORT_STORAGE_PREFIX}${exportJobId}.zip`);

    // 讀回暫存 zip 並解開，驗證目錄結構。
    const zipBuf = await streamToBuffer(await getStorageProvider().getStream(report.storageKey!));
    const files = unzipSync(new Uint8Array(zipBuf));
    const names = Object.keys(files).sort();
    expect(names).toContain("指南/README.md");
    expect(names).toContain("指南/安裝.md");
    expect(names).toContain("總覽.md");
    expect(names).toContain(`assets/${att.id}.png`);

    // 資料夾頁自身內容進 README，標題化為 H1，圖片連結改寫為相對路徑。
    const readme = strFromU8(files["指南/README.md"]!);
    expect(readme).toContain("# 指南");
    expect(readme).toContain(`../assets/${att.id}.png`);
    expect(readme).not.toContain("/api/files/");

    // ── round-trip：以 J-02 匯入新空間 ──
    const space2 = await seedSpace(user.id, { name: "還原空間" });
    const importKey = `import-rt-${randomUUID()}.zip`;
    await getStorageProvider().put(importKey, zipBuf);
    const imp = await runImportZip({
      storageKey: importKey,
      fileName: "roundtrip.zip",
      spaceId: space2.id,
      parentId: null,
      userId: user.id,
    });
    expect(imp.phase).toBe("completed");
    expect(imp.createdPages).toBe(3);
    expect(imp.uploadedImages).toBe(1);
    expect(imp.rewrittenImageLinks).toBe(1);

    const rows = await db
      .select()
      .from(pages)
      .where(and(eq(pages.spaceId, space2.id), isNull(pages.deletedAt)));
    expect(rows).toHaveLength(3);
    const guide = rows.find((p) => p.title === "指南");
    const setup = rows.find((p) => p.title === "安裝");
    const overview = rows.find((p) => p.title === "總覽");
    expect(guide).toBeDefined();
    expect(setup).toBeDefined();
    expect(overview).toBeDefined();

    // 階層保留：安裝 掛在 指南 下；指南／總覽 為根層。
    expect(guide!.parentId).toBeNull();
    expect(overview!.parentId).toBeNull();
    expect(setup!.parentId).toBe(guide!.id);

    // 圖片保留：指南 內容含 image 節點，指向新空間的新附件。
    const newAtt = await db.select().from(attachments).where(eq(attachments.spaceId, space2.id));
    expect(newAtt).toHaveLength(1);
    const images = collectImages(guide!.content as ProseMirrorDoc);
    expect(images).toHaveLength(1);
    expect(images[0]!.attrs).toEqual({ src: `/api/files/${newAtt[0]!.id}`, alt: "架構圖" });
    expect(guide!.contentMd).toContain(`/api/files/${newAtt[0]!.id}`);

    // 清理匯出暫存檔（避免殘留干擾 purge 測試斷言）。
    await getStorageProvider().delete(report.storageKey!);
  });

  it("purgeExpiredExports 刪除逾期匯出暫存檔、保留仍在期者", async () => {
    const storage = getStorageProvider();
    const freshKey = `${EXPORT_STORAGE_PREFIX}${randomUUID()}.zip`;
    const staleKey = `${EXPORT_STORAGE_PREFIX}${randomUUID()}.zip`;
    await storage.put(freshKey, Buffer.from(PNG));
    await storage.put(staleKey, Buffer.from(PNG));

    // maxAgeMs=-1：cutoff 在未來 → 所有現存檔皆視為逾期（涵蓋剛寫入者）。
    const deleted = await purgeExpiredExports(-1);
    expect(deleted).toBeGreaterThanOrEqual(2);
    await expect(storage.getStream(freshKey)).rejects.toThrow();
    await expect(storage.getStream(staleKey)).rejects.toThrow();

    // maxAgeMs 很大：不刪任何檔。
    const survivorKey = `${EXPORT_STORAGE_PREFIX}${randomUUID()}.zip`;
    await storage.put(survivorKey, Buffer.from(PNG));
    const deleted2 = await purgeExpiredExports(60 * 60 * 1000);
    expect(deleted2).toBe(0);
    await expect(storage.getStream(survivorKey)).resolves.toBeDefined();
    await storage.delete(survivorKey);
  });
});
