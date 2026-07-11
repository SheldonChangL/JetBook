import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronRight, Download, RotateCcw } from "lucide-react";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import {
  decodeCursor,
  listAuditActions,
  listAuditLogs,
  parseAuditFilter,
} from "@/lib/admin/audit";
import { Button } from "@/components/ui/button";
import { AuditFilters } from "./audit-filters";
import { AuditTable, type AuditTableRow } from "./audit-table";

// 依 URL 過濾條件即時查詢，不做靜態化。
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("auditTitle") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** 從 searchParams 取單值（陣列取首項）。 */
function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** 只保留過濾相關 query（actor/from/to/actions），供匯出與分頁連結沿用（不含游標）。 */
function filterQuery(sp: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["actor", "from", "to", "actions"] as const) {
    const value = firstValue(sp[key]);
    if (value != null && value !== "") params.set(key, value);
  }
  return params;
}

/**
 * 稽核日誌檢視頁（L-04，F-ADMIN-05）。org admin only（layout 已擋，page 再驗防 soft navigation）。
 * 過濾列 ＋ 表格（時間／actor／action／target／ip ＋ 展開 metadata）＋ (created_at,id) 游標分頁 ＋ CSV 匯出。
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { user } = await requireSession("/admin/audit");
  if (!isOrgAdmin(user)) notFound();
  const t = await getTranslations("admin");

  const sp = await searchParams;
  const filter = parseAuditFilter((key) => firstValue(sp[key]));
  const cursor = decodeCursor(firstValue(sp.cursor));

  const [availableActions, page] = await Promise.all([
    listAuditActions(),
    listAuditLogs(filter, cursor),
  ]);

  const dateFormat = new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "medium",
  });

  const rows: AuditTableRow[] = page.rows.map((row) => ({
    id: row.id,
    createdLabel: dateFormat.format(row.createdAt),
    actorName: row.actorName,
    actorEmail: row.actorEmail,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    ip: row.ip,
    metadata: row.metadata,
  }));

  const baseQuery = filterQuery(sp);
  const exportHref = `/api/admin/audit/export${baseQuery.size > 0 ? `?${baseQuery}` : ""}`;

  const nextQuery = new URLSearchParams(baseQuery);
  if (page.nextCursor) nextQuery.set("cursor", page.nextCursor);
  const nextHref = `/admin/audit?${nextQuery}`;
  const firstPageHref = `/admin/audit${baseQuery.size > 0 ? `?${baseQuery}` : ""}`;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 text-fg">{t("auditTitle")}</h1>
          <p className="text-body-ui text-fg-secondary">{t("auditDesc")}</p>
        </div>
        <Button asChild variant="secondary">
          <a href={exportHref} download>
            <Download aria-hidden className="size-4" />
            {t("auditExport")}
          </a>
        </Button>
      </header>

      <AuditFilters
        availableActions={availableActions}
        initial={{
          actions: filter.actions ?? [],
          actor: firstValue(sp.actor) ?? "",
          from: firstValue(sp.from) ?? "",
          to: firstValue(sp.to) ?? "",
        }}
      />

      <AuditTable rows={rows} />

      <nav className="flex items-center justify-between gap-3" aria-label={t("auditPagination")}>
        <div>
          {cursor ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={firstPageHref}>
                <RotateCcw aria-hidden className="size-4" />
                {t("auditBackToLatest")}
              </Link>
            </Button>
          ) : null}
        </div>
        <div>
          {page.nextCursor ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={nextHref}>
                {t("auditNextPage")}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
