"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

/** 伺服器端已序列化的稽核列（Date 已格式化為 createdLabel；metadata 保留物件供展開顯示）。 */
export interface AuditTableRow {
  id: number;
  createdLabel: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  ip: string | null;
  metadata: unknown;
}

/** action badge 顏色：依網域前綴／動詞分色（失敗紅、刪除橙、認證藍、AI 紫，其餘中性）。 */
function actionVariant(action: string): BadgeProps["variant"] {
  if (action.endsWith("_failed")) return "danger";
  if (action.includes("delete") || action.includes("purge")) return "warning";
  if (action.startsWith("auth.")) return "primary";
  if (action.startsWith("ai.")) return "ai";
  return "neutral";
}

/**
 * 稽核日誌表格（L-04）：時間／actor 名／action badge／target／ip ＋ 可展開的 metadata JSON。
 * 展開狀態為每列本地狀態；資料與過濾／分頁由 server 傳入（本元件不查資料）。
 */
export function AuditTable({ rows }: { rows: AuditTableRow[] }) {
  const t = useTranslations("admin");

  if (rows.length === 0) {
    return (
      <EmptyState
        title={t("auditEmptyTitle")}
        description={t("auditEmptyDesc")}
        className="archive-admin-empty"
      />
    );
  }

  return (
    <div
      className="archive-admin-table-wrap overflow-x-auto rounded-md border border-edge"
      role="region"
      aria-label={t("auditTitle")}
      tabIndex={0}
    >
      <table className="archive-admin-table w-full min-w-[920px] text-body-ui">
        <thead>
          <tr className="border-b border-edge bg-sidebar text-left text-caption text-fg-tertiary">
            <th className="w-8 px-2 py-2" />
            <th className="px-3 py-2 font-medium whitespace-nowrap">{t("auditColTime")}</th>
            <th className="px-3 py-2 font-medium">{t("auditColActor")}</th>
            <th className="px-3 py-2 font-medium">{t("auditColAction")}</th>
            <th className="px-3 py-2 font-medium">{t("auditColTarget")}</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">{t("auditColIp")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <AuditRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditRow({ row }: { row: AuditTableRow }) {
  const t = useTranslations("admin");
  const [expanded, setExpanded] = useState(false);
  const hasMetadata = row.metadata != null && Object.keys(row.metadata as object).length > 0;

  return (
    <>
      <tr className="border-b border-edge last:border-b-0">
        <td className="px-2 py-2 align-top">
          {hasMetadata ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? t("auditCollapse") : t("auditExpand")}
              className="flex size-6 items-center justify-center rounded-sm text-fg-tertiary transition-colors hover:bg-hover hover:text-fg"
            >
              {expanded ? (
                <ChevronDown aria-hidden className="size-4" />
              ) : (
                <ChevronRight aria-hidden className="size-4" />
              )}
            </button>
          ) : null}
        </td>
        <td className="px-3 py-2 align-top whitespace-nowrap text-fg-secondary tabular-nums">
          {row.createdLabel}
        </td>
        <td className="px-3 py-2 align-top">
          {row.actorName ? (
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-fg">{row.actorName}</span>
              {row.actorEmail ? (
                <span className="truncate text-caption text-fg-tertiary">{row.actorEmail}</span>
              ) : null}
            </div>
          ) : (
            <span className="text-fg-tertiary">{t("auditAnonymous")}</span>
          )}
        </td>
        <td className="px-3 py-2 align-top">
          <Badge variant={actionVariant(row.action)}>
            <span className="font-mono">{row.action}</span>
          </Badge>
        </td>
        <td className="px-3 py-2 align-top">
          <div className="flex min-w-0 flex-col">
            <span className="text-fg-secondary">{row.targetType}</span>
            {row.targetId ? (
              <span className="truncate font-mono text-caption text-fg-tertiary">
                {row.targetId}
              </span>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2 align-top whitespace-nowrap font-mono text-caption text-fg-secondary">
          {row.ip ?? "—"}
        </td>
      </tr>
      {expanded && hasMetadata ? (
        <tr className="border-b border-edge bg-sidebar/50 last:border-b-0">
          <td />
          <td colSpan={5} className="px-3 pb-3">
            <pre className="max-h-72 overflow-auto rounded-sm border border-edge bg-base p-3 text-caption text-fg-secondary">
              {JSON.stringify(row.metadata, null, 2)}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}
