import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { getCurrentSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { withMetrics } from "@/lib/metrics/http";
import { maxUploadBytes, saveAttachment, UploadValidationError } from "@/lib/storage/upload";
import type { UploadValidationErrorCode } from "@/lib/storage/validate";

export const dynamic = "force-dynamic";

const fieldsSchema = z.object({
  spaceId: z.uuid(),
  pageId: z.uuid().nullable().default(null),
});

const VALIDATION_HTTP: Record<UploadValidationErrorCode, { status: number; message: string }> = {
  FILE_EMPTY: { status: 400, message: "檔案內容為空" },
  FILE_TOO_LARGE: { status: 413, message: "檔案超過大小上限" },
  INVALID_FILE_TYPE: { status: 415, message: "不允許的檔案類型（副檔名與 MIME 需在白名單內）" },
};

/**
 * 附件上傳 API（M-01）。薄殼：驗 session → 驗 page.edit 權限 → 呼叫 lib 儲存管線。
 * POST /api/upload（multipart/form-data：file、spaceId、pageId?）
 */
async function handlePOST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }

  // Content-Length 預檢：超限直接 413，不先把整包 body 讀進記憶體
  // （multipart 邊界/欄位額外負擔給 1MB 餘裕；實際檔案大小由 saveAttachment 再驗）
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxUploadBytes() + 1024 * 1024) {
    return NextResponse.json(
      { error: { code: "FILE_TOO_LARGE", message: VALIDATION_HTTP.FILE_TOO_LARGE.message } },
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
    pageId: formData.get("pageId") ?? null,
  });
  const file = formData.get("file");
  if (!parsed.success || !(file instanceof File)) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "缺少 file 或 spaceId（uuid）欄位" } },
      { status: 400 },
    );
  }
  const { spaceId, pageId } = parsed.data;

  if (!(await can(session.user, "page.edit", { type: "page", spaceId }))) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "無此空間的編輯權限" } }, { status: 403 });
  }

  // pageId 必須屬於該 space 且未刪除（防跨 space 掛載）
  if (pageId) {
    const page = await db.query.pages.findFirst({
      where: and(eq(pages.id, pageId), eq(pages.spaceId, spaceId), isNull(pages.deletedAt)),
      columns: { id: true },
    });
    if (!page) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "pageId 不存在或不屬於該空間" } },
        { status: 400 },
      );
    }
  }

  try {
    const attachment = await saveAttachment({
      spaceId,
      pageId,
      uploaderId: session.user.id,
      fileName: file.name,
      mimeType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
    });

    await writeAudit({
      actorId: session.user.id,
      action: "attachment.upload",
      targetType: "attachment",
      targetId: attachment.id,
      metadata: { spaceId, pageId, fileName: attachment.fileName, sizeBytes: attachment.sizeBytes },
      ip: ipFromHeaders(request.headers),
    });

    return NextResponse.json({ data: { id: attachment.id } }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadValidationError) {
      const mapped = VALIDATION_HTTP[error.code];
      return NextResponse.json(
        { error: { code: error.code, message: mapped.message } },
        { status: mapped.status },
      );
    }
    throw error;
  }
}

export const POST = withMetrics("/api/upload", handlePOST);
