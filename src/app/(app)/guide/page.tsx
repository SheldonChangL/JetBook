import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, KeyRound, Search, Share2, Trash2, PenLine, BookOpen } from "lucide-react";
import { requireSession } from "@/lib/auth/current";
import { env } from "@/lib/env";
import { McpSetup } from "@/components/mcp/mcp-setup";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("guide");
  return { title: t("title") };
}

/**
 * 使用說明頁：新使用者的單一入口——JetBook 基本用法 + 把知識庫接給 AI 助理（MCP）。
 * MCP 設定片段由 McpSetup 以 env.BASE_URL 產生，與設定頁建立 token 後的畫面同一份。
 */
export default async function GuidePage() {
  await requireSession("/guide");
  const t = await getTranslations("guide");

  const basics = [
    { key: "search", Icon: Search },
    { key: "read", Icon: BookOpen },
    { key: "write", Icon: PenLine },
    { key: "share", Icon: Share2 },
    { key: "trash", Icon: Trash2 },
  ] as const;

  return (
    <main className="archive-guide mx-auto flex max-w-[880px] flex-col gap-8 px-6 py-8">
      <header className="archive-guide-header flex flex-col gap-2">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1 text-caption text-fg-tertiary transition-colors hover:text-fg"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          {t("backHome")}
        </Link>
        <p className="archive-guide-kicker">{t("archiveKicker")}</p>
        <h1 className="text-h1 text-fg">{t("title")}</h1>
        <p className="text-body-ui text-fg-secondary">{t("intro")}</p>
      </header>

      <section className="archive-guide-section flex flex-col gap-3">
        <h2 className="text-h2 text-fg">{t("basics.heading")}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {basics.map(({ key, Icon }) => (
            <li key={key} className="flex flex-col gap-1 rounded-md border border-edge bg-raised p-4">
              <p className="flex items-center gap-2 text-body-ui font-medium text-fg">
                <Icon aria-hidden className="size-4 text-fg-tertiary" />
                {t(`basics.${key}Title`)}
              </p>
              <p className="text-body-ui text-fg-secondary">{t(`basics.${key}Body`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="mcp" className="archive-guide-section flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-h2 text-fg">{t("mcp.heading")}</h2>
          <p className="text-body-ui text-fg-secondary">{t("mcp.intro")}</p>
        </div>

        <div className="rounded-md border border-edge bg-raised p-4">
          <p className="text-body-ui font-medium text-fg">{t("mcp.examplesHeading")}</p>
          <ul className="mt-2 flex flex-col gap-1 text-body-ui text-fg-secondary">
            <li>{t("mcp.example1")}</li>
            <li>{t("mcp.example2")}</li>
            <li>{t("mcp.example3")}</li>
          </ul>
        </div>

        <ol className="flex flex-col gap-5">
          <li className="flex flex-col gap-2">
            <h3 className="text-h3 text-fg">{t("mcp.step1Title")}</h3>
            <p className="text-body-ui text-fg-secondary">{t("mcp.step1Body")}</p>
            <Link
              href="/settings#api-tokens"
              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-body-ui text-fg transition-colors hover:bg-hover"
            >
              <KeyRound aria-hidden className="size-4" />
              {t("mcp.step1Cta")}
            </Link>
          </li>

          <li className="flex flex-col gap-3">
            <h3 className="text-h3 text-fg">{t("mcp.step2Title")}</h3>
            <p className="text-body-ui text-fg-secondary">{t("mcp.step2Body")}</p>
            <McpSetup baseUrl={env.BASE_URL} />
          </li>

          <li className="flex flex-col gap-2">
            <h3 className="text-h3 text-fg">{t("mcp.step3Title")}</h3>
            <p className="text-body-ui text-fg-secondary">{t("mcp.step3Body")}</p>
          </li>
        </ol>

        <div className="flex flex-col gap-3 rounded-md border border-edge p-4">
          <h3 className="text-h3 text-fg">{t("mcp.toolsHeading")}</h3>
          <div>
            <p className="text-body-ui font-medium text-fg">{t("mcp.toolsReadTitle")}</p>
            <p className="text-body-ui text-fg-secondary">{t("mcp.toolsRead")}</p>
          </div>
          <div>
            <p className="text-body-ui font-medium text-fg">{t("mcp.toolsWriteTitle")}</p>
            <p className="text-body-ui text-fg-secondary">{t("mcp.toolsWrite")}</p>
          </div>
        </div>

        <div className="flex flex-col gap-1 rounded-md bg-warning-tint px-4 py-3">
          <p className="text-body-ui font-medium text-warning">{t("mcp.securityTitle")}</p>
          <p className="text-body-ui text-warning">{t("mcp.securityBody")}</p>
        </div>
      </section>

      <section className="archive-guide-section flex flex-col gap-2">
        <h2 className="text-h2 text-fg">{t("more.heading")}</h2>
        <ul className="flex flex-col gap-1 text-body-ui">
          <li>
            <Link href="/api-docs" className="text-primary hover:underline">
              {t("more.apiDocs")}
            </Link>
          </li>
          <li>
            <Link href="/settings" className="text-primary hover:underline">
              {t("more.settings")}
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
