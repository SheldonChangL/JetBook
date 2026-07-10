import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { actionAllowedForRole, getSpaceRole } from "@/lib/authz/permission";
import { listSpaceTreeNodes } from "@/lib/pages/tree";
import { PageTree } from "@/components/tree/page-tree";

/**
 * Space 版面（C-03）：AppShell 內容區內自帶第二欄——260px 頁面樹側欄（md 以下摺疊），
 * 右側為頁面內容。樹以 server 端撈平面列表、client 端組裝。
 */
export default async function SpaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;
  const { user } = await requireSession(`/s/${spaceSlug}`);

  const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, spaceSlug) });
  if (!space || space.deletedAt) notFound();

  const role = await getSpaceRole(user, space.id);
  if (!role) notFound();

  const nodes = await listSpaceTreeNodes(space.id);
  const canEdit = actionAllowedForRole("page.edit", role);

  return (
    <div className="flex h-full">
      <aside
        aria-label={space.name}
        className="hidden w-[260px] shrink-0 overflow-y-auto border-r border-edge bg-sidebar md:block"
      >
        <PageTree spaceId={space.id} spaceSlug={space.slug} nodes={nodes} canEdit={canEdit} />
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
