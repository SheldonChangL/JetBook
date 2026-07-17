import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { isEmbeddingConfigured } from "@/lib/llm";
import { getAiSettingsSummary } from "@/lib/llm/settings";
import { getAiUsageDaily } from "@/lib/admin/ai-usage";
import { getAiDailyQuotaPerUser } from "@/lib/ai/quota";
import { Badge } from "@/components/ui/badge";
import { ReindexButton } from "@/app/admin/system/reindex-button";
import { TestConnectionButton } from "./test-connection-button";
import { UsageChart } from "./usage-chart";
import { QuotaForm } from "./quota-form";

// 連線設定與用量即時反映 env／稽核，不做靜態化。
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("aiTitle") };
}

/**
 * AI 設定與用量後台頁（L-03，F-ADMIN-04）。
 * - 連線設定唯讀（12-factor，C6）：provider／模型／遮罩 key／embedding，來自 env，無可編輯欄位、無 sampling 參數。
 * - [測試連線]：實打 provider 最小請求回報成功／失敗原因。
 * - 全庫重嵌：觸發＋進度＋失敗清單（營運操作，可執行）。
 * - 用量統計：近 30 日 `ai.query` 稽核聚合（次數／tokens 按日）。
 * layout 已擋 org admin；page 再驗一次（防 soft navigation 繞過）。
 */
export default async function AdminAiPage() {
  const { user } = await requireSession("/admin/ai");
  if (!isOrgAdmin(user)) notFound();
  const t = await getTranslations("admin");

  const settings = getAiSettingsSummary();
  const embeddingConfigured = isEmbeddingConfigured();
  const usage = await getAiUsageDaily(30);
  const dailyQuota = await getAiDailyQuotaPerUser();

  const { llm, embedding } = settings;

  return (
    <div className="archive-admin-page archive-admin-ai mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="archive-admin-page-header flex flex-col gap-1">
        <p className="archive-admin-kicker ui-archive-only">{t("archiveAiKicker")}</p>
        <h1 className="text-h1 text-fg">{t("aiTitle")}</h1>
        <p className="text-body-ui text-fg-secondary">{t("aiDesc")}</p>
      </header>

      <div className="archive-admin-ai-grid grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 卡片一：LLM Provider（唯讀，C6） */}
        <ConnectionCard
          title={t("aiLlmCardTitle")}
          badge={
            llm.configured ? (
              <Badge variant="ai">{t("aiConfigured")}</Badge>
            ) : (
              <Badge variant="neutral">{t("aiNotConfigured")}</Badge>
            )
          }
        >
          {llm.configured ? (
            <>
              <dl className="flex flex-col divide-y divide-edge">
                <InfoRow
                  label={t("aiFieldProvider")}
                  value={llm.provider ? t(`aiProvider.${llm.provider}`) : "—"}
                />
                <InfoRow label={t("aiFieldModelPrimary")} value={llm.modelPrimary} mono />
                <InfoRow label={t("aiFieldModelLight")} value={llm.modelLight} mono />
                {llm.baseUrl && <InfoRow label={t("aiFieldBaseUrl")} value={llm.baseUrl} mono />}
                {llm.apiKeyLast4 && (
                  <InfoRow
                    label={t("aiFieldApiKey")}
                    value={llm.apiKeyLast4}
                    mono
                    note={t("aiMasked")}
                  />
                )}
              </dl>
              <ReadOnlyCaption>{t("aiReadonlyCaption")}</ReadOnlyCaption>
              <TestConnectionButton target="llm" configured={llm.configured} />
            </>
          ) : (
            <UnconfiguredHint>{t("aiLlmNotConfiguredHint")}</UnconfiguredHint>
          )}
        </ConnectionCard>

        {/* 卡片二：Embedding Provider（唯讀，C6） */}
        <ConnectionCard
          title={t("aiEmbeddingCardTitle")}
          badge={
            embedding.configured ? (
              <Badge variant="ai">{t("aiConfigured")}</Badge>
            ) : (
              <Badge variant="neutral">{t("aiNotConfigured")}</Badge>
            )
          }
        >
          {embedding.configured ? (
            <>
              <dl className="flex flex-col divide-y divide-edge">
                <InfoRow label={t("aiFieldBaseUrl")} value={embedding.baseUrl} mono />
                <InfoRow label={t("aiFieldModel")} value={embedding.model} mono />
                <InfoRow label={t("aiFieldDimensions")} value={String(embedding.dimensions)} mono />
              </dl>
              <ReadOnlyCaption>{t("aiReadonlyCaption")}</ReadOnlyCaption>
              <TestConnectionButton target="embedding" configured={embedding.configured} />
            </>
          ) : (
            <UnconfiguredHint>{t("aiEmbeddingNotConfiguredHint")}</UnconfiguredHint>
          )}
        </ConnectionCard>
      </div>

      {/* 卡片三：全庫重嵌（營運操作，可執行；含進度與失敗清單） */}
      <section className="archive-admin-card rounded-md border border-edge">
        <div className="archive-admin-card-head border-b border-edge bg-sidebar px-4 py-2.5">
          <h2 className="text-body-ui font-semibold text-fg">{t("reindexSectionTitle")}</h2>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-body-ui text-fg-secondary">{t("reindexSectionDesc")}</p>
          <ReindexButton embeddingConfigured={embeddingConfigured} />
        </div>
      </section>

      {/* 卡片四：每人每日用量配額（I-09，F-AI-11） */}
      <section className="archive-admin-card rounded-md border border-edge">
        <div className="archive-admin-card-head border-b border-edge bg-sidebar px-4 py-2.5">
          <h2 className="text-body-ui font-semibold text-fg">{t("aiQuotaCardTitle")}</h2>
        </div>
        <div className="px-4 py-4">
          <QuotaForm currentQuota={dailyQuota} />
        </div>
      </section>

      {/* 卡片五：近 30 日用量統計 */}
      <section className="archive-admin-card rounded-md border border-edge">
        <div className="archive-admin-card-head border-b border-edge bg-sidebar px-4 py-2.5">
          <h2 className="text-body-ui font-semibold text-fg">{t("aiUsageCardTitle")}</h2>
        </div>
        <div className="px-4 py-4">
          <UsageChart summary={usage} />
        </div>
      </section>
    </div>
  );
}

function ConnectionCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="archive-admin-card archive-admin-connection-card flex flex-col gap-3 rounded-md border border-edge p-4">
      <div className="archive-admin-card-head flex items-center justify-between gap-2">
        <h2 className="text-body-ui font-semibold text-fg">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

function InfoRow({
  label,
  value,
  mono,
  note,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  note?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="shrink-0 text-caption text-fg-tertiary">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span
          className={`min-w-0 break-all text-right text-body-ui text-fg-secondary${mono ? " font-mono" : ""}`}
        >
          {value ?? "—"}
        </span>
        {note && <Badge variant="neutral">{note}</Badge>}
      </dd>
    </div>
  );
}

function ReadOnlyCaption({ children }: { children: ReactNode }) {
  return <p className="text-caption text-fg-tertiary">{children}</p>;
}

function UnconfiguredHint({ children }: { children: ReactNode }) {
  return <p className="text-body-ui text-fg-tertiary">{children}</p>;
}
