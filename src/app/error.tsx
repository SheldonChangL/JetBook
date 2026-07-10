"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** 500 錯誤頁（G-04，設計規範 §3.12）：錯誤代碼（digest 供回報）＋重新整理。 */
export default function ErrorPage({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors.serverError");

  useEffect(() => {
    // 供瀏覽器端除錯；伺服器端完整堆疊由 pino 記錄。
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-base">
      <EmptyState
        icon={<AlertTriangle />}
        title={t("title")}
        description={error.digest ? t("digest", { digest: error.digest }) : t("description")}
        action={
          <Button variant="primary" onClick={() => window.location.reload()}>
            {t("reload")}
          </Button>
        }
      />
    </main>
  );
}
