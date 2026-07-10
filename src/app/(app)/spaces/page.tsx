import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateSpaceButton } from "./create-space-button";

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
  const list = await listAccessibleSpaces(user);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-h1 text-fg">{t("title")}</h1>
        <CreateSpaceButton />
      </header>

      {list.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((space) => (
            <li key={space.id}>
              <Link
                href={`/s/${space.slug}`}
                className="flex h-full flex-col gap-2 rounded-md border border-edge bg-raised p-4 transition-shadow hover:shadow-sm"
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
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
