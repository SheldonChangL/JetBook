import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { checkDatabase, checkLlm, checkStorage, getEnvSummary } from "@/lib/health";
import { Badge } from "@/components/ui/badge";

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

  const [database, storage] = await Promise.all([checkDatabase(), checkStorage()]);
  const llm = checkLlm();
  const summary = getEnvSummary();

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
