import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** 404 頁（G-04，設計規範 §3.12）：說明＋回首頁。 */
export default async function NotFoundPage() {
  const t = await getTranslations("errors.notFound");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-base">
      <EmptyState
        icon={<FileQuestion />}
        title={t("title")}
        description={t("description")}
        action={
          <Button asChild variant="primary">
            <Link href="/">{t("backHome")}</Link>
          </Button>
        }
      />
    </main>
  );
}
