import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { getCurrentSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { getStorageProvider } from "@/lib/storage/provider";
import { fileExtension } from "@/lib/storage/validate";
import { MAX_TOTAL_BYTES } from "@/lib/content/import-zip";
import { enqueueImportZip } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

/** 上傳 zip 大小上限（bytes）：對齊解壓總量上限（壓縮檔通常更小，此為安全上界）。 */
const MAX_ZIP_UPLOAD_BYTES = MAX_TOTAL_BYTES;

/** 允許的 zip MIME（瀏覽器差異大；空／octet-stream 亦放行，內容由解壓時再驗）。 */
const ZIP_MIME_ALLOW = new Set(["application/zip", "application/x-zip-compressed", "application/octet-stream", ""]);

const fieldsSchema = z.object({
  spaceId: z.uuid(),
  parentId: z.uuid().nullable().default(null),
});

/**
 * Zip 批次匯入啟動 API（J-02）。薄殼：驗 session → 驗 page.edit 權限 → 暫存 zip 至
 * StorageProvider → enqueue import-zip job（實際解壓／建頁在 worker）。回傳 jobId 供輪詢。
 * POST /api/import（multipart/form-data：file(zip)、spaceId、parentId?）
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  // Content-Length 預檢：超限直接 413（多預留 1MB 給 multipart 邊界／欄位）
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_ZIP_UPLOAD_BYTES + 1024 * 1024) {
    return NextResponse.json(
      { error: { code: "FILE_TOO_LARGE", message: "壓縮檔超過大小上限" } },
      { status: 413 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "需為 multipart/form-data" } },
      { status: 400 },
    );
  }

  const parsed = fieldsSchema.safeParse({
    spaceId: formData.get("spaceId"),
    parentId: formData.get("parentId") ?? null,
  });
  const file = formData.get("file");
  if (!parsed.success || !(file instanceof File)) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "缺少 file 或 spaceId（uuid）欄位" } },
      { status: 400 },
    );
  }
  const { spaceId, parentId } = parsed.data;

  if (fileExtension(file.name) !== ".zip" || !ZIP_MIME_ALLOW.has(file.type.toLowerCase())) {
    return NextResponse.json(
      { error: { code: "INVALID_FILE_TYPE", message: "僅接受 .zip 壓縮檔" } },
      { status: 415 },
    );
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: { code: "FILE_EMPTY", message: "檔案內容為空" } }, { status: 400 });
  }
  if (file.size > MAX_ZIP_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: { code: "FILE_TOO_LARGE", message: "壓縮檔超過大小上限" } },
      { status: 413 },
    );
  }

  if (!(await can(session.user, "page.edit", { type: "page", spaceId }))) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "無此空間的編輯權限" } }, { status: 403 });
  }

  // parentId 必須屬於該 space 且未刪除（防跨 space 掛載）
  if (parentId) {
    const page = await db.query.pages.findFirst({
      where: and(eq(pages.id, parentId), eq(pages.spaceId, spaceId), isNull(pages.deletedAt)),
      columns: { id: true },
    });
    if (!page) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "parentId 不存在或不屬於該空間" } },
        { status: 400 },
      );
    }
  }

  // 暫存 zip 至 StorageProvider（worker 讀回後刪除）。
  const storageKey = `import-${randomUUID()}.zip`;
  await getStorageProvider().put(storageKey, Buffer.from(await file.arrayBuffer()));

  let jobId: string | null;
  try {
    jobId = await enqueueImportZip({
      storageKey,
      fileName: file.name,
      spaceId,
      parentId,
      userId: session.user.id,
    });
  } catch (error) {
    // enqueue 失敗：回收暫存 zip，不留孤兒檔。
    await getStorageProvider().delete(storageKey).catch(() => undefined);
    throw error;
  }
  if (!jobId) {
    await getStorageProvider().delete(storageKey).catch(() => undefined);
    return NextResponse.json(
      { error: { code: "ENQUEUE_FAILED", message: "無法建立匯入工作" } },
      { status: 500 },
    );
  }

  await writeAudit({
    actorId: session.user.id,
    action: "space.import_zip",
    targetType: "space",
    targetId: spaceId,
    metadata: { fileName: file.name, sizeBytes: file.size, parentId, jobId },
    ip: ipFromHeaders(request.headers),
  });

  return NextResponse.json({ data: { jobId } }, { status: 202 });
}
