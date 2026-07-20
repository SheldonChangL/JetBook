import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Paperclip, Search as SearchIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/current";
import { fullTextSearch } from "@/lib/search/fulltext";
import { searchAttachmentsByName } from "@/lib/search/attachments";
import { listSearchAuthors } from "@/lib/search/filters";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import { isPreviewConverterConfigured } from "@/lib/storage/office-preview";
import {
  attachmentFileUrl,
  formatFileSize,
  isOfficePreviewCandidate,
  isPreviewableAttachment,
} from "@/components/editor/attachment/attachment-utils";
import { AttachmentPreviewButton } from "@/components/content/attachment-preview";
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
    <div className="archive-search-page mx-auto max-w-3xl px-6 py-8">
      <header className="archive-search-header">
        <p className="archive-search-kicker">{t("archiveKicker")}</p>
        <h1 className="mb-4 text-h1 text-fg">{t("title")}</h1>
        <p className="archive-search-subtitle">{t("archiveSubtitle")}</p>
      </header>
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
          filterHeading: t("archiveFilterHeading"),
          resultsHeading: t("archiveResultsHeading"),
          resultCount: t("archiveResultCount", { count: hits.length }),
        }}
      />

      {attachmentHits.length > 0 && (
        <section className="archive-search-attachments mt-8 flex flex-col gap-2">
          <div className="archive-search-section-heading">
            <span><SearchIcon aria-hidden />{t("archiveAttachmentIndex")}</span>
            <h2 className="text-caption font-medium text-fg-tertiary">
              {t("attachmentsHeading", { count: attachmentHits.length })}
            </h2>
          </div>
          <ul className="archive-search-attachment-list flex flex-col divide-y divide-edge rounded-md border border-edge">
            {attachmentHits.map((hit) => (
              <li key={hit.id} className="archive-search-attachment-row flex items-center gap-3 px-4 py-3">
                <span className="archive-search-file-icon"><Paperclip aria-hidden /></span>
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
                {isPreviewableAttachment(hit.fileName) ||
                (isPreviewConverterConfigured() && isOfficePreviewCandidate(hit.fileName)) ? (
                  <AttachmentPreviewButton attachmentId={hit.id} fileName={hit.fileName} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
