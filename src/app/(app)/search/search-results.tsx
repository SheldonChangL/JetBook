"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SearchHit } from "@/lib/search/fulltext";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FilterOption {
  id: string;
  name: string;
}

interface SearchLabels {
  searchPlaceholder: string;
  noResults: string;
  allSpaces: string;
  spaceLabel: string;
  updatedLabel: string;
  updated7: string;
  updated30: string;
  updatedAll: string;
  authorLabel: string;
  allAuthors: string;
  authorSearchPlaceholder: string;
  authorEmpty: string;
}

/** 「全部」哨兵值：Radix Select item value 不可為空字串，故以 "all" 表示未篩選。 */
const ALL = "all";

/** 由目前查詢字與過濾值組出 /search URL（空值/全部不進 query string）。 */
function toSearchUrl(q: string, space: string, updated: string, author: string): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q);
  if (space !== ALL) params.set("space", space);
  if (updated !== ALL) params.set("updated", updated);
  if (author !== ALL) params.set("author", author);
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

export function SearchResults({
  initialQuery,
  initialHits,
  spaces,
  authors,
  selectedSpace,
  selectedUpdated,
  selectedAuthor,
  labels,
}: {
  initialQuery: string;
  initialHits: SearchHit[];
  spaces: FilterOption[];
  authors: FilterOption[];
  selectedSpace: string;
  selectedUpdated: string;
  selectedAuthor: string;
  labels: SearchLabels;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  // 查詢文字改變時同步 state（filter 導航後 server 會回帶最新 query）。
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const authorOptions: ComboboxOption[] = useMemo(
    () => authors.map((a) => ({ value: a.id, label: a.name })),
    [authors],
  );

  // 輸入停止 350ms 後更新 URL（伺服器端重查，權限一致）；過濾值變更時重置計時器，
  // 避免尚未觸發的 debounce 以舊過濾值覆蓋剛切換的過濾器。
  useEffect(() => {
    if (query === initialQuery) return;
    const id = setTimeout(() => {
      router.replace(toSearchUrl(query, selectedSpace, selectedUpdated, selectedAuthor));
    }, 350);
    return () => clearTimeout(id);
  }, [query, initialQuery, selectedSpace, selectedUpdated, selectedAuthor, router]);

  return (
    <div className="flex flex-col gap-4">
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={labels.searchPlaceholder}
      />

      <div className="flex flex-wrap gap-3">
        {/* Space 過濾 */}
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-caption text-fg-tertiary">{labels.spaceLabel}</span>
          <Select
            value={selectedSpace}
            onValueChange={(value) =>
              router.replace(toSearchUrl(query, value, selectedUpdated, selectedAuthor))
            }
          >
            <SelectTrigger aria-label={labels.spaceLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{labels.allSpaces}</SelectItem>
              {spaces.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        {/* 更新時間過濾 */}
        <label className="flex min-w-32 flex-1 flex-col gap-1">
          <span className="text-caption text-fg-tertiary">{labels.updatedLabel}</span>
          <Select
            value={selectedUpdated}
            onValueChange={(value) =>
              router.replace(toSearchUrl(query, selectedSpace, value, selectedAuthor))
            }
          >
            <SelectTrigger aria-label={labels.updatedLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{labels.updatedAll}</SelectItem>
              <SelectItem value="7">{labels.updated7}</SelectItem>
              <SelectItem value="30">{labels.updated30}</SelectItem>
            </SelectContent>
          </Select>
        </label>

        {/* 作者過濾 */}
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-caption text-fg-tertiary">{labels.authorLabel}</span>
          <Combobox
            options={authorOptions}
            value={selectedAuthor === ALL ? null : selectedAuthor}
            onValueChange={(value) =>
              router.replace(toSearchUrl(query, selectedSpace, selectedUpdated, value ?? ALL))
            }
            placeholder={labels.allAuthors}
            searchPlaceholder={labels.authorSearchPlaceholder}
            emptyText={labels.authorEmpty}
          />
        </label>
      </div>

      {initialQuery.trim() && initialHits.length === 0 ? (
        <p className="text-body-ui text-fg-tertiary">{labels.noResults}</p>
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
