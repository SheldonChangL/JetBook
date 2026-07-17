import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { actionAllowedForRole, resolveSpaceAccess } from "@/lib/authz/permission";
import { listSpaceTreeNodes } from "@/lib/pages/tree";
import { decodeRouteParam } from "@/lib/utils";
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
  // route param 為 percent-encoded；含 CJK 的 slug 須還原才比對得到 DB（issue #207）
  const spaceSlug = decodeRouteParam((await params).spaceSlug);
  const { user } = await requireSession(`/s/${spaceSlug}`);

  const space = await db.query.spaces.findFirst({ where: eq(spaces.slug, spaceSlug) });
  if (!space || space.deletedAt) notFound();

  const { role, archived } = await resolveSpaceAccess(user, space.id);
  if (!role) notFound();

  const nodes = await listSpaceTreeNodes(space.id);
  // 封存 space 唯讀（F-ORG-04）：即使角色為 editor+ 也不顯示建立／拖曳／垃圾桶等寫入入口。
  const canEdit = !archived && actionAllowedForRole("page.edit", role);
  // 還原需 page.delete（＝editor+）；與 canEdit 同級，故共用旗標控制垃圾桶入口顯示。
  const tShell = await getTranslations("shell");

  return (
    <div className="archive-space-layout flex h-full">
      <aside
        aria-label={space.name}
        className="archive-space-tree hidden w-[260px] shrink-0 flex-col border-r border-edge bg-sidebar md:flex"
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PageTree spaceId={space.id} spaceSlug={space.slug} nodes={nodes} canEdit={canEdit} />
        </div>
        {canEdit ? (
          <div className="shrink-0 border-t border-edge p-2">
            <Link
              href={`/trash?space=${space.slug}`}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-body-ui text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
            >
              <Trash2 aria-hidden className="size-4" />
              <span className="truncate">{tShell("trash")}</span>
            </Link>
          </div>
        ) : null}
      </aside>
      <div className="archive-space-content min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
