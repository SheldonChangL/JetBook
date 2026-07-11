import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { listCollections } from "@/lib/spaces/collections";
import { groupSpacesByCollection } from "@/lib/spaces/grouping";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CollectionActions } from "./collection-actions";
import { CreateCollectionButton } from "./create-collection-button";
import { CreateSpaceButton } from "./create-space-button";
import { SpaceCollectionAssign } from "./space-collection-assign";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("spaces");
  return { title: t("title") };
}

const visibilityVariant = {
  private: "neutral",
  org_read: "primary",
  org_write: "success",
} as const;

export default async function SpacesPage() {
  const { user } = await requireSession("/spaces");
  const t = await getTranslations("spaces");
  const admin = isOrgAdmin(user);
  const [list, collections] = await Promise.all([listAccessibleSpaces(user), listCollections()]);
  const collectionRefs = collections.map((c) => ({ id: c.id, name: c.name }));
  // org admin 看得到空 collection 以便指派；一般使用者只看含可存取空間的分組。
  const groups = groupSpacesByCollection(list, collectionRefs, { includeEmpty: admin });

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-h1 text-fg">{t("title")}</h1>
        <div className="flex items-center gap-2">
          {admin ? <CreateCollectionButton /> : null}
          <CreateSpaceButton />
        </div>
      </header>

      {groups.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => {
            const showHeader = group.collection !== null || groups.length > 1;
            return (
              <section
                key={group.collection?.id ?? "__ungrouped__"}
                className="flex flex-col gap-3"
              >
                {showHeader ? (
                  <div className="flex items-center justify-between gap-2 border-b border-edge pb-1.5">
                    <h2 className="text-h4 text-fg">
                      {group.collection ? group.collection.name : t("ungrouped")}
                    </h2>
                    {admin && group.collection ? (
                      <CollectionActions
                        collectionId={group.collection.id}
                        name={group.collection.name}
                      />
                    ) : null}
                  </div>
                ) : null}

                {group.spaces.length === 0 ? (
                  <p className="text-body-ui text-fg-tertiary">{t("collectionEmpty")}</p>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {group.spaces.map((space) => (
                      <li key={space.id} className="flex flex-col gap-1.5">
                        <Link
                          href={`/s/${space.slug}`}
                          className="flex flex-1 flex-col gap-2 rounded-md border border-edge bg-raised p-4 transition-shadow hover:shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-h4 text-fg">
                              {space.icon ? `${space.icon} ` : ""}
                              {space.name}
                            </span>
                            <Badge variant={visibilityVariant[space.visibility]}>
                              {t(`visibility.${space.visibility}`)}
                            </Badge>
                          </div>
                          {space.description ? (
                            <p className="line-clamp-2 text-body-ui text-fg-secondary">
                              {space.description}
                            </p>
                          ) : null}
                        </Link>
                        {admin ? (
                          <SpaceCollectionAssign
                            spaceId={space.id}
                            currentCollectionId={space.collectionId}
                            collections={collectionRefs}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
