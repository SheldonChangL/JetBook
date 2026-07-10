"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SearchHit } from "@/lib/search/fulltext";
import { Input } from "@/components/ui/input";

export function SearchResults({
  initialQuery,
  initialHits,
  noResultsLabel,
}: {
  initialQuery: string;
  initialHits: SearchHit[];
  noResultsLabel: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  // 輸入停止 350ms 後更新 URL（伺服器端重查，權限一致）
  useEffect(() => {
    if (query === initialQuery) return;
    const id = setTimeout(() => {
      router.replace(`/search?q=${encodeURIComponent(query)}`);
    }, 350);
    return () => clearTimeout(id);
  }, [query, initialQuery, router]);

  return (
    <div className="flex flex-col gap-4">
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜尋…"
      />
      {initialQuery.trim() && initialHits.length === 0 ? (
        <p className="text-body-ui text-fg-tertiary">{noResultsLabel}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {initialHits.map((hit) => (
            <li key={hit.pageId}>
              <Link
                href={`/s/${hit.spaceSlug}/${hit.slug}`}
                className="block rounded-md border border-edge bg-raised p-3 transition-shadow hover:shadow-sm"
              >
                <div className="text-body-ui font-medium text-fg">{hit.title}</div>
                <div className="text-caption text-fg-tertiary">{hit.spaceName}</div>
                <div
                  className="mt-1 line-clamp-2 text-caption text-fg-secondary [&_mark]:bg-primary-tint [&_mark]:text-primary"
                  dangerouslySetInnerHTML={{ __html: hit.snippet }}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
