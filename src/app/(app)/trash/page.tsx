import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { EmptyState } from "@/components/ui/empty-state";

/** 全域回收桶（跨 space 彙整檢視，C-12 定義）；還原與清除由 C-08 實作。 */
export default async function TrashPage() {
  await requireSession("/trash");
  const t = await getTranslations("trash");
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-4 text-h1 text-fg">{t("title")}</h1>
      <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
    </div>
  );
}
