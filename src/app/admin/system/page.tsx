import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { checkDatabase, checkLlm, checkStorage, getEnvSummary } from "@/lib/health";
import { getStorageUsage } from "@/lib/storage/usage";
import { isEmbeddingConfigured } from "@/lib/llm";
import { formatFileSize } from "@/components/editor/attachment/attachment-utils";
import { Badge } from "@/components/ui/badge";
import { ReindexButton } from "./reindex-button";

// 每次請求即時檢查，不做靜態化
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("systemTitle") };
}

/** 系統設定健康檢查頁（L-02，F-ADMIN-03）：唯讀卡片＋環境摘要，秘密一律遮罩。 */
export default async function AdminSystemPage() {
  // layout 已擋，但 page 再驗一次（防 soft navigation 繞過；session 查詢有 React cache）
  const { user } = await requireSession("/admin/system");
  if (!isOrgAdmin(user)) notFound();
  const t = await getTranslations("admin");

  const [database, storage, usage] = await Promise.all([
    checkDatabase(),
    checkStorage(),
    getStorageUsage(),
  ]);
  const llm = checkLlm();
  const summary = getEnvSummary();
  const embeddingConfigured = isEmbeddingConfigured();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 text-fg">{t("systemTitle")}</h1>
        <p className="text-body-ui text-fg-secondary">{t("systemDesc")}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* DB：SELECT 1 ＋延遲 */}
        <StatusCard
          title={t("systemCardDb")}
          badge={
            <Badge variant={database.status === "ok" ? "success" : "danger"}>
              {database.status === "ok" ? t("systemStatusOk") : t("systemStatusError")}
            </Badge>
          }
        >
          {database.latencyMs !== undefined && (
            <p className="text-body-ui text-fg-secondary">
              {t("systemLatency", { ms: database.latencyMs })}
            </p>
          )}
          {database.detail && <DetailLine>{database.detail}</DetailLine>}
        </StatusCard>

        {/* 儲存：UPLOAD_DIR 可寫測試 */}
        <StatusCard
          title={t("systemCardStorage")}
          badge={
            <Badge variant={storage.status === "ok" ? "success" : "danger"}>
              {storage.status === "ok" ? t("systemStatusOk") : t("systemStatusError")}
            </Badge>
          }
        >
          <p className="text-body-ui text-fg-secondary">
            {t("systemStoragePath")}
            <DetailLine>{summary.uploadDir}</DetailLine>
          </p>
          {storage.detail && <DetailLine>{storage.detail}</DetailLine>}
        </StatusCard>

        {/* LLM：M1 僅顯示設定狀態，連線檢查 M2 回填 */}
        <StatusCard
          title={t("systemCardLlm")}
          badge={
            llm.status === "configured" ? (
              <Badge variant="primary">{t("systemLlmConfigured")}</Badge>
            ) : (
              <Badge variant="neutral">{t("systemLlmNotConfigured")}</Badge>
            )
          }
        >
          {llm.status === "configured" ? (
            <p className="text-body-ui text-fg-secondary">
              {t("systemLlmProvider")}
              <DetailLine>{llm.provider}</DetailLine>
            </p>
          ) : (
            <p className="text-body-ui text-fg-tertiary">{t("systemLlmHint")}</p>
          )}
        </StatusCard>
      </div>

      {/* 環境摘要（DATABASE_URL 已遮罩憑證） */}
      <section className="rounded-md border border-edge">
        <h2 className="border-b border-edge bg-sidebar px-4 py-2.5 text-body-ui font-semibold text-fg">
          {t("systemEnvTitle")}
        </h2>
        <dl className="flex flex-col divide-y divide-edge">
          <EnvRow label={t("systemEnvNodeEnv")} value={summary.nodeEnv} />
          <EnvRow label={t("systemEnvBaseUrl")} value={summary.baseUrl} />
          <EnvRow
            label={t("systemEnvDatabaseUrl")}
            value={summary.databaseUrl}
            note={t("systemEnvMasked")}
          />
          <EnvRow label={t("systemEnvUploadDir")} value={summary.uploadDir} />
        </dl>
      </section>

      {/* 附件儲存用量（M-03，F-ADMIN-07）：全站與各空間附件數／大小＋孤兒待回收 */}
      <section className="rounded-md border border-edge">
        <div className="border-b border-edge bg-sidebar px-4 py-2.5">
          <h2 className="text-body-ui font-semibold text-fg">{t("storageUsageTitle")}</h2>
        </div>
        <div className="flex flex-col gap-4 px-4 py-4">
          <p className="text-body-ui text-fg-secondary">{t("storageUsageDesc")}</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <UsageStat label={t("storageUsageTotalCount")} value={t("storageUsageCountUnit", { count: usage.totalCount })} />
            <UsageStat label={t("storageUsageTotalSize")} value={formatFileSize(usage.totalBytes) || "0 B"} />
            <UsageStat
              label={t("storageUsageOrphanCount")}
              value={t("storageUsageCountUnit", { count: usage.orphanCount })}
              hint={t("storageUsageOrphanHint")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-body-ui font-semibold text-fg">{t("storageUsagePerSpaceTitle")}</h3>
            {usage.perSpace.length === 0 ? (
              <p className="text-body-ui text-fg-tertiary">{t("storageUsageEmpty")}</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-edge">
                <table className="w-full border-collapse text-body-ui">
                  <thead>
                    <tr className="border-b border-edge bg-sidebar text-left text-fg-secondary">
                      <th className="px-3 py-2 font-medium">{t("storageUsageColSpace")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("storageUsageColCount")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("storageUsageColSize")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge">
                    {usage.perSpace.map((row) => (
                      <tr key={row.spaceId}>
                        <td className="px-3 py-2 text-fg">{row.spaceName}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-secondary">
                          {row.count}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-secondary">
                          {formatFileSize(row.bytes) || "0 B"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* AI 全庫重嵌（H-07，F-AI-02）：換模型／維度變更後重建索引；關閉索引空間一併清除 */}
      <section className="rounded-md border border-edge">
        <div className="border-b border-edge bg-sidebar px-4 py-2.5">
          <h2 className="text-body-ui font-semibold text-fg">{t("reindexSectionTitle")}</h2>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-body-ui text-fg-secondary">{t("reindexSectionDesc")}</p>
          <ReindexButton embeddingConfigured={embeddingConfigured} />
        </div>
      </section>
    </div>
  );
}

function StatusCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-edge p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-body-ui font-semibold text-fg">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

function UsageStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-edge p-4">
      <span className="text-caption text-fg-secondary">{label}</span>
      <span className="text-h2 tabular-nums text-fg">{value}</span>
      {hint && <span className="text-caption text-fg-tertiary">{hint}</span>}
    </div>
  );
}

function DetailLine({ children }: { children: ReactNode }) {
  return <span className="block break-all font-mono text-caption text-fg-tertiary">{children}</span>;
}

function EnvRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-2.5 md:flex-row md:items-center md:gap-4">
      <dt className="w-44 shrink-0 font-mono text-caption text-fg-tertiary">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span className="break-all font-mono text-body-ui text-fg-secondary">{value}</span>
        {note && <Badge variant="neutral">{note}</Badge>}
      </dd>
    </div>
  );
}
