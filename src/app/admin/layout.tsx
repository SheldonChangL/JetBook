import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/current";
import { isOrgAdmin } from "@/lib/authz/permission";
import { getBuildInfo } from "@/lib/build-info-server";
import { ArchiveAdminShell } from "@/components/layout/archive-admin-shell";

/**
 * 管理後台獨立版面（§3.11）：僅 org admin 可進入；非 admin 一律 404（不洩漏後台存在性）。
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user } = await requireSession("/admin");
  if (!isOrgAdmin(user)) notFound();
  const buildInfo = getBuildInfo();

  return (
    <ArchiveAdminShell user={{ name: user.name, email: user.email }} buildInfo={buildInfo}>
      {children}
    </ArchiveAdminShell>
  );
}
