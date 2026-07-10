import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { getSpaceRole } from "@/lib/authz/spaces";

/**
 * Space 首頁（暫版）：驗證存取權；完整頁面樹與首頁內容由 C-03/C-06 實作。
 */
export default async function SpaceHomePage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;
  const { user } = await requireSession(`/s/${spaceSlug}`);

  const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, spaceSlug) });
  if (!space || space.deletedAt) notFound();

  const role = await getSpaceRole(user, space.id);
  if (!role) notFound();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-8">
      <h1 className="text-h1 text-fg">
        {space.icon ? `${space.icon} ` : ""}
        {space.name}
      </h1>
      {space.description ? (
        <p className="text-body-read text-fg-secondary">{space.description}</p>
      ) : null}
    </main>
  );
}
