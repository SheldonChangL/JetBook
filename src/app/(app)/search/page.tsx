import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { fullTextSearch } from "@/lib/search/fulltext";
import { SearchResults } from "./search-results";

/** 完整搜尋結果頁（Cmd+K「顯示全部」目的地，G7/F-SEARCH-03）。 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { user } = await requireSession("/search");
  const { q = "" } = await searchParams;
  const t = await getTranslations("search");
  const hits = q.trim() ? await fullTextSearch(user, q) : [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-4 text-h1 text-fg">{t("title")}</h1>
      <SearchResults initialQuery={q} initialHits={hits} noResultsLabel={t("noResults")} />
    </div>
  );
}
