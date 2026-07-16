import type { ReactNode } from "react";

export function ArchiveSystemState({
  code,
  icon,
  title,
  description,
  action,
  details,
  fullViewport = false,
}: {
  code: string;
  icon: ReactNode;
  title: string;
  description: string;
  action: ReactNode;
  details?: ReactNode;
  fullViewport?: boolean;
}) {
  return (
    <div
      className={`archive-canvas flex items-center justify-center bg-base px-5 py-12 ${
        fullViewport ? "min-h-dvh" : "min-h-full"
      }`}
    >
      <section className="grid w-full max-w-2xl border-y border-edge bg-raised/90 sm:grid-cols-[132px_minmax(0,1fr)] sm:border sm:shadow-md">
        <div className="flex items-center gap-4 border-b border-edge px-6 py-6 sm:flex-col sm:items-start sm:border-b-0 sm:border-r sm:px-7 sm:py-8">
          <span className="font-mono text-[32px] font-semibold tracking-[-0.04em] text-primary">
            {code}
          </span>
          <span
            aria-hidden
            className="grid size-10 place-items-center rounded-xs bg-primary-tint text-primary [&>svg]:size-5"
          >
            {icon}
          </span>
        </div>
        <div className="px-6 py-8 sm:px-8 sm:py-10">
          <h1 className="text-h2 text-fg">{title}</h1>
          <p className="mt-3 max-w-md text-body-ui text-fg-secondary">{description}</p>
          {details ? <div className="mt-5">{details}</div> : null}
          <div className="mt-6">{action}</div>
        </div>
      </section>
    </div>
  );
}
