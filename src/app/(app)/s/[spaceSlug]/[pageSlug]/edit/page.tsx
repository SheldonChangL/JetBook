import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, spaces } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { can } from "@/lib/authz/permission";
import { acquireLock } from "@/lib/pages/lock";
import { PageEditor } from "@/components/editor/page-editor";
import { EditLockNotice } from "./edit-lock-notice";
import type { ProseMirrorDoc } from "@/lib/content/types";

export default async function EditPage({
  params,
}: {
  params: Promise<{ spaceSlug: string; pageSlug: string }>;
}) {
  const { spaceSlug, pageSlug } = await params;
  const { user } = await requireSession(`/s/${spaceSlug}/${pageSlug}/edit`);

  const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, spaceSlug) });
  if (!space) notFound();
  const page = await db.query.pages.findFirst({
    where: and(eq(pages.spaceId, space.id), eq(pages.slug, pageSlug), isNull(pages.deletedAt)),
  });
  if (!page) notFound();

  if (!(await can(user, "page.edit", { type: "page", spaceId: space.id }))) {
    notFound();
  }

  // 嘗試取鎖；他人持鎖則顯示鎖定提示（唯讀），Admin 可搶鎖
  const acquired = await acquireLock(page.id, user.id);
  if (!acquired) {
    return (
      <EditLockNotice
        pageId={page.id}
        spaceSlug={spaceSlug}
        isOrgAdmin={user.orgRole === "admin"}
      />
    );
  }

  return (
    <PageEditor
      pageId={page.id}
      spaceSlug={spaceSlug}
      initialTitle={page.title}
      initialContent={(page.content as ProseMirrorDoc | null) ?? null}
      initialVersionNo={page.currentVersionNo}
    />
  );
}
