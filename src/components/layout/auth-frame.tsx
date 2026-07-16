import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { ArchiveMark } from "@/components/brand/archive-mark";
import type { UiVersion } from "@/lib/ui-version";

export async function AuthFrame({
  uiVersion,
  title,
  legacySubtitle = title,
  children,
}: {
  uiVersion: UiVersion;
  title: string;
  legacySubtitle?: string;
  children: ReactNode;
}) {
  const tc = await getTranslations("common");
  const ta = await getTranslations("auth");

  if (uiVersion === "legacy") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-sidebar px-4">
        <div className="w-full max-w-[400px] rounded-lg border border-edge bg-raised p-8 shadow-lg">
          <div className="mb-6 flex flex-col items-center gap-1">
            <h1 className="text-h2 text-fg">{tc("appName")}</h1>
            <p className="text-caption text-fg-tertiary">{legacySubtitle}</p>
          </div>
          {children}
        </div>
        <p className="mt-6 text-caption text-fg-tertiary">{ta("copyright")}</p>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh bg-base lg:grid-cols-[minmax(320px,0.82fr)_minmax(480px,1.18fr)]">
      <section className="relative hidden overflow-hidden border-r border-[var(--archive-rail-border)] bg-[var(--archive-rail)] p-10 text-[var(--archive-rail-text-active)] lg:flex lg:flex-col xl:p-14">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xs bg-[var(--archive-index)] text-[var(--archive-index-ink)]">
            <ArchiveMark className="size-8 [&_path]:stroke-current [&_path:first-child]:fill-transparent" />
          </span>
          <span>
            <strong className="block text-h3">{tc("appName")}</strong>
            <span className="font-mono text-[10px] tracking-[0.16em] text-[var(--archive-rail-text)]">
              {ta("archiveKicker")}
            </span>
          </span>
        </div>

        <div className="my-auto max-w-md">
          <p className="mb-4 font-mono text-caption tracking-[0.12em] text-[var(--archive-index)]">
            {ta("archiveAccess")}
          </p>
          <h1 className="text-[32px] font-semibold leading-[1.35] tracking-[-0.025em]">
            {ta("archiveTitle")}
          </h1>
          <p className="mt-5 max-w-sm text-body-read text-[var(--archive-rail-text)]">
            {ta("archiveDescription")}
          </p>
          <div aria-hidden className="mt-10 grid gap-3 opacity-70">
            <span className="h-px bg-[var(--archive-rail-border)]" />
            <span className="h-px w-4/5 bg-[var(--archive-rail-border)]" />
            <span className="h-px w-3/5 bg-[var(--archive-rail-border)]" />
          </div>
        </div>

        <p className="font-mono text-[10px] tracking-[0.12em] text-[var(--archive-rail-text)]">
          {ta("copyright")}
        </p>
      </section>

      <section className="archive-canvas flex min-h-dvh items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[440px] border-y border-edge bg-raised/90 px-1 py-8 sm:border sm:px-8 sm:shadow-md">
          <div className="mb-7 flex items-start gap-3">
            <ArchiveMark className="mt-0.5 size-9 lg:hidden" />
            <div>
              <p className="font-mono text-[10px] tracking-[0.14em] text-primary">
                {ta("archiveAccess")}
              </p>
              <h1 className="mt-1 text-h2 text-fg">{title}</h1>
              <p className="mt-1 text-caption text-fg-tertiary">{ta("tagline")}</p>
            </div>
          </div>
          {children}
          <p className="mt-8 text-caption text-fg-tertiary lg:hidden">{ta("copyright")}</p>
        </div>
      </section>
    </main>
  );
}
