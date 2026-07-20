import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import {
  listActiveUsers,
  listSpaceGroupMembers,
  listSpaceGroups,
  listSpaceMembers,
} from "@/lib/spaces/manage";
import { listGroups } from "@/lib/admin/groups";
import { decodeRouteParam } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { GeneralSection } from "./general-section";
import { VisibilitySection } from "./visibility-section";
import { MemberSection } from "./member-section";
import { GroupSection } from "./group-section";
import { ImportSection } from "./import-section";
import { ExportSection } from "./export-section";
import { ArchiveSection } from "./archive-section";
import { DeleteSection } from "./delete-section";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("spaceSettings");
  return { title: t("title") };
}

/**
 * Space 權限管理設定頁（C-07，設計規範 §3.10）。僅 space admin（space.manage）可進；
 * 其餘角色一律 notFound。含可見性三態、成員與角色管理、封存。
 */
export default async function SpaceSettingsPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  // route param 為 percent-encoded；含 CJK 的 slug 須還原才比對得到 DB（issue #207）
  const spaceSlug = decodeRouteParam((await params).spaceSlug);
  const { user } = await requireSession(`/s/${spaceSlug}/settings`);

  const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, spaceSlug) });
  if (!space || space.deletedAt) notFound();

  // 僅空間管理者可管理權限（deny by default）；非管理者視同不存在
  if (!(await can(user, "space.manage", { type: "space", spaceId: space.id }))) notFound();

  const t = await getTranslations("spaceSettings");
  const [members, groupMembers, spaceGroups, candidates, allGroups] = await Promise.all([
    listSpaceMembers(space.id),
    listSpaceGroupMembers(space.id),
    listSpaceGroups(space.id),
    listActiveUsers(),
    listGroups(),
  ]);
  const groupCandidates = allGroups.map((g) => ({ id: g.id, name: g.name }));

  return (
    <main className="archive-settings-page mx-auto flex max-w-[880px] flex-col gap-8 px-6 py-8">
      <header className="archive-settings-header flex flex-col gap-2">
        <Link
          href={`/s/${space.slug}`}
          className="inline-flex w-fit items-center gap-1 text-caption text-fg-tertiary transition-colors hover:text-fg"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          {t("backToSpace")}
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-h1 text-fg">
            {space.icon ? `${space.icon} ` : ""}
            {space.name}
          </h1>
          {space.archivedAt ? <Badge variant="warning">{t("archivedBadge")}</Badge> : null}
        </div>
        <p className="text-body-ui text-fg-secondary">{t("title")}</p>
      </header>

      <div className="archive-settings-layout flex flex-col gap-8">
        <nav className="archive-settings-nav" aria-label={t("archiveNavLabel")}>
          <ul>
            <li><a href="#general-heading">{t("generalTitle")}</a></li>
            <li><a href="#visibility-heading">{t("visibilityHeading")}</a></li>
            <li><a href="#members-heading">{t("membersHeading")}</a></li>
            <li><a href="#groups-heading">{t("groupsHeading")}</a></li>
            <li><a href="#import-heading">{t("importHeading")}</a></li>
            <li><a href="#export-heading">{t("exportHeading")}</a></li>
            <li><a href="#archive-heading">{t("archiveHeading")}</a></li>
            <li><a href="#delete-heading">{t("deleteHeading")}</a></li>
          </ul>
        </nav>

        <div className="archive-settings-content flex min-w-0 flex-col gap-8">
          {space.archivedAt ? (
            <p className="rounded-md border border-edge bg-warning-tint px-4 py-3 text-body-ui text-warning">
              {t("archivedNotice")}
            </p>
          ) : null}

          <GeneralSection
            spaceId={space.id}
            initialName={space.name}
            initialDescription={space.description}
            initialIcon={space.icon}
          />

          <VisibilitySection spaceId={space.id} visibility={space.visibility} />

          <MemberSection
            spaceId={space.id}
            currentUserId={user.id}
            members={members}
            groupMembers={groupMembers}
            candidates={candidates}
          />

          <GroupSection spaceId={space.id} groups={spaceGroups} candidates={groupCandidates} />

          <ImportSection spaceId={space.id} spaceSlug={space.slug} />

          <ExportSection spaceId={space.id} />

          <ArchiveSection
            spaceId={space.id}
            spaceName={space.name}
            archived={space.archivedAt !== null}
          />

          <DeleteSection spaceId={space.id} spaceName={space.name} />
        </div>
      </div>
    </main>
  );
}
