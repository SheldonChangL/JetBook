import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getCurrentSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { parseAuditFilter, streamAuditCsv } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

/**
 * 稽核日誌 CSV 匯出（L-04，F-ADMIN-05）。薄殼：驗 session → 驗 org admin → 串流 lib 層。
 * 依當前過濾條件（時間範圍／action／actor，與檢視頁共用 parseAuditFilter）匯出，上限 10k 列。
 * 串流輸出避免整批載入記憶體；非 org admin 一律 404（不洩漏後台存在性）。
 * GET /api/admin/audit/export?actions=...&actor=...&from=...&to=...
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "需登入" } }, { status: 401 });
  }
  if (!isOrgAdmin(session.user)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "不存在" } }, { status: 404 });
  }

  const url = new URL(request.url);
  const filter = parseAuditFilter((key) => url.searchParams.get(key));

  const t = await getTranslations("admin");
  const headerLabels = [
    t("auditColTime"),
    t("auditColActor"),
    t("auditCsvColEmail"),
    t("auditColAction"),
    t("auditColTargetType"),
    t("auditColTargetId"),
    t("auditColIp"),
    t("auditColMetadata"),
  ];

  const iterator = streamAuditCsv(filter, headerLabels);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(value));
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "").replace(/-/g, "");
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-logs-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
