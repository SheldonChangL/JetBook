import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/current";
import { openApiSpec } from "@/lib/api/openapi";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("apiDocs");
  return { title: t("title") };
}

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;

/**
 * REST API 文件頁（M4-06，F-API-01 驗收 2）：由 openApiSpec 單一事實來源渲染，
 * 並提供原始 openapi.json 連結。
 */
export default async function ApiDocsPage() {
  await requireSession("/api-docs");
  const t = await getTranslations("apiDocs");

  const paths = Object.entries(openApiSpec.paths);

  return (
    <main className="mx-auto flex max-w-[880px] flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/settings"
          className="inline-flex w-fit items-center gap-1 text-caption text-fg-tertiary transition-colors hover:text-fg"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          {t("backToSettings")}
        </Link>
        <h1 className="text-h1 text-fg">{openApiSpec.info.title}</h1>
        <p className="text-body-ui text-fg-secondary">{openApiSpec.info.description}</p>
        <a
          href="/api/v1/openapi.json"
          className="w-fit text-body-ui text-primary hover:underline"
        >
          {t("rawSpec")}
        </a>
      </header>

      <ul className="flex flex-col gap-4">
        {paths.map(([path, operations]) => (
          <li key={path} className="rounded-md border border-edge p-4">
            {METHOD_ORDER.filter((m) => m in operations).map((method) => {
              const op = (operations as Record<string, {
                summary?: string;
                description?: string;
                parameters?: readonly { name: string; in: string; required?: boolean }[];
                responses?: Record<string, { description?: string }>;
              }>)[method]!;
              return (
                <div key={method} className="flex flex-col gap-2">
                  <p className="flex items-center gap-2">
                    <span className="rounded-sm bg-primary-tint px-2 py-0.5 font-mono text-caption font-semibold uppercase text-primary">
                      {method}
                    </span>
                    <code className="font-mono text-body-ui text-fg">{path}</code>
                  </p>
                  <p className="text-body-ui font-medium text-fg">{op.summary}</p>
                  {op.description && (
                    <p className="text-body-ui text-fg-secondary">{op.description}</p>
                  )}
                  {op.parameters && op.parameters.length > 0 && (
                    <p className="text-caption text-fg-tertiary">
                      {t("params", {
                        list: op.parameters
                          .map((p) =>
                            p.required
                              ? t("paramRequired", { name: p.name, location: p.in })
                              : t("paramOptional", { name: p.name, location: p.in }),
                          )
                          .join(t("paramSeparator")),
                      })}
                    </p>
                  )}
                  {op.responses && (
                    <ul className="flex flex-col gap-0.5 text-caption text-fg-tertiary">
                      {Object.entries(op.responses).map(([status, res]) => (
                        <li key={status}>
                          <code className="font-mono">{status}</code>
                          <span className="ml-2">{res.description}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </li>
        ))}
      </ul>
    </main>
  );
}
