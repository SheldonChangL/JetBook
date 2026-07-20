import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArchiveSystemState } from "@/components/layout/archive-system-state";

/** 404 頁（G-04，設計規範 §3.12）：說明＋回首頁。 */
export default async function NotFoundPage() {
  const t = await getTranslations("errors.notFound");

  return (
    <ArchiveSystemState
      code={t("code")}
      icon={<FileQuestion />}
      title={t("title")}
      description={t("description")}
      fullViewport
      action={
        <Button asChild variant="primary">
          <Link href="/">{t("backHome")}</Link>
        </Button>
      }
    />
  );
}
