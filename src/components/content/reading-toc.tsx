"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { TableOfContentsItem } from "@/lib/content/toc";
import { cn } from "@/lib/utils";

export function ReadingToc({
  items,
  compact = false,
}: {
  items: TableOfContentsItem[];
  compact?: boolean;
}) {
  const t = useTranslations("reading");
  const [activeId, setActiveId] = useState(items[0]?.id ?? null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    setActiveId(items[0]?.id ?? null);
    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((heading): heading is HTMLElement => heading !== null);
    if (!headings.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0]?.target;
        if (first instanceof HTMLElement) setActiveId(first.id);
      },
      { rootMargin: "-16% 0px -70% 0px", threshold: [0, 1] },
    );
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [items]);

  const links = items.length ? (
    <ol className="archive-reading-toc-list">
      {items.map((item) => (
        <li key={item.id} data-level={item.level}>
          <a
            href={`#${item.id}`}
            aria-current={activeId === item.id ? "location" : undefined}
            onClick={() => {
              setActiveId(item.id);
              if (detailsRef.current) detailsRef.current.open = false;
            }}
          >
            {item.text}
          </a>
        </li>
      ))}
    </ol>
  ) : (
    <p className="archive-reading-toc-empty">{t("archiveTocEmpty")}</p>
  );

  if (compact) {
    const activeTitle = items.find((item) => item.id === activeId)?.text;
    return (
      <details ref={detailsRef} className="archive-reading-toc-compact">
        <summary>
          <span>
            <strong>{t("archiveToc")}</strong>
            {activeTitle ? <small>{activeTitle}</small> : null}
          </span>
          <ChevronDown aria-hidden className="size-4" />
        </summary>
        <nav aria-label={t("archiveToc")}>{links}</nav>
      </details>
    );
  }

  return (
    <nav className={cn("archive-reading-toc")} aria-label={t("archiveToc")}>
      {links}
    </nav>
  );
}
