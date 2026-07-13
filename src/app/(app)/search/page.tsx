import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Paperclip } from "lucide-react";
import { requireSession } from "@/lib/auth/current";
import { fullTextSearch } from "@/lib/search/fulltext";
import { searchAttachmentsByName } from "@/lib/search/attachments";
import { listSearchAuthors } from "@/lib/search/filters";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import {
  attachmentFileUrl,
  formatFileSize,
} from "@/components/editor/attachment/attachment-utils";
import { SearchResults } from "./search-results";

/** 更新時間過濾允許值（7 天 / 30 天 / 全部）。 */
const UPDATED_DAYS: Record<string, number> = { "7": 7, "30": 30 };

/** 完整搜尋結果頁（Cmd+K「顯示全部」目的地，G7/F-SEARCH-03）。 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; space?: string; updated?: string; author?: string }>;
}) {
  const { user } = await requireSession("/search");
  const { q = "", space = "all", updated = "all", author = "all" } = await searchParams;
  const t = await getTranslations("search");

  // 過濾器候選（權限在 SQL 層過濾）。
  const [spaces, authors] = await Promise.all([
    listAccessibleSpaces(user),
    listSearchAuthors(user),
  ]);

  // 只採用有效選項，避免使用者塞入無權/不存在的值造成不一致的高亮狀態。
  const spaceId = spaces.some((s) => s.id === space) ? space : undefined;
  const authorId = authors.some((a) => a.id === author) ? author : undefined;
  const updatedWithinDays = UPDATED_DAYS[updated];

  const trimmedQuery = q.trim();
  const [hits, attachmentHits] = trimmedQuery
    ? await Promise.all([
        fullTextSearch(user, trimmedQuery, { spaceId, authorId, updatedWithinDays }),
        // 附件檔名搜尋（M4-04）：不受 space/作者/時間過濾器影響，權限過濾同鐵律
        searchAttachmentsByName(user, trimmedQuery),
      ])
    : [[], []];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-4 text-h1 text-fg">{t("title")}</h1>
      <SearchResults
        initialQuery={q}
        initialHits={hits}
        spaces={spaces.map((s) => ({ id: s.id, name: s.name }))}
        authors={authors}
        selectedSpace={spaceId ?? "all"}
        selectedUpdated={updated in UPDATED_DAYS ? updated : "all"}
        selectedAuthor={authorId ?? "all"}
        labels={{
          searchPlaceholder: t("searchPlaceholder"),
          noResults: t("noResults"),
          allSpaces: t("filters.allSpaces"),
          spaceLabel: t("filters.spaceLabel"),
          updatedLabel: t("filters.updatedLabel"),
          updated7: t("filters.updated7"),
          updated30: t("filters.updated30"),
          updatedAll: t("filters.updatedAll"),
          authorLabel: t("filters.authorLabel"),
          allAuthors: t("filters.allAuthors"),
          authorSearchPlaceholder: t("filters.authorSearchPlaceholder"),
          authorEmpty: t("filters.authorEmpty"),
        }}
      />

      {attachmentHits.length > 0 && (
        <section className="mt-8 flex flex-col gap-2">
          <h2 className="text-caption font-medium text-fg-tertiary">
            {t("attachmentsHeading", { count: attachmentHits.length })}
          </h2>
          <ul className="flex flex-col divide-y divide-edge rounded-md border border-edge">
            {attachmentHits.map((hit) => (
              <li key={hit.id} className="flex items-center gap-3 px-4 py-3">
                <Paperclip aria-hidden className="size-4 shrink-0 text-fg-tertiary" />
                <div className="min-w-0 flex-1">
                  <a
                    href={attachmentFileUrl(hit.id)}
                    className="block truncate text-body-ui font-medium text-fg hover:underline"
                  >
                    {hit.fileName}
                  </a>
                  <p className="flex gap-2 truncate text-caption text-fg-tertiary">
                    <span className="shrink-0">{formatFileSize(hit.sizeBytes)}</span>
                    <Link
                      href={`/s/${hit.spaceSlug}/${hit.pageSlug}`}
                      className="truncate hover:text-fg hover:underline"
                    >
                      {t("attachmentPageLocation", {
                        space: hit.spaceName,
                        page: hit.pageTitle || t("untitledPage"),
                      })}
                    </Link>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
