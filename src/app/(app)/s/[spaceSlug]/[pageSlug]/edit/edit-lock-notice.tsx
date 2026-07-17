"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { acquireLockAction } from "@/actions/lock";
import { Button } from "@/components/ui/button";
import { LockKeyhole } from "lucide-react";

/** 他人編輯中的鎖定提示（C1/R5）：唯讀返回，或 Admin 搶鎖。 */
export function EditLockNotice({
  pageId,
  spaceSlug,
  isOrgAdmin,
  lockedByName,
}: {
  pageId: string;
  spaceSlug: string;
  isOrgAdmin: boolean;
  lockedByName: string | null;
}) {
  const t = useTranslations("editor");
  const router = useRouter();

  async function steal() {
    if (!confirm(t("stealConfirm"))) return;
    await acquireLockAction(pageId, true);
    router.refresh();
  }

  return (
    <div className="archive-lock-notice mx-auto max-w-2xl px-6 py-12 text-center">
      <div className="archive-lock-notice-icon ui-archive-only">
        <LockKeyhole aria-hidden />
      </div>
      <p className="archive-lock-notice-kicker ui-archive-only">{t("archiveProtection")}</p>
      <h1 className="text-h2 text-fg">{t("lockedTitle")}</h1>
      <p className="archive-lock-notice-copy mt-2 text-body-ui text-fg-secondary">
        {lockedByName ? t("lockedByHint", { name: lockedByName }) : t("lockedHint")}
      </p>
      <div className="archive-lock-notice-actions mt-6 flex justify-center gap-2">
        <Button variant="secondary" onClick={() => router.push(`/s/${spaceSlug}`)}>
          {t("backToReading")}
        </Button>
        {isOrgAdmin ? (
          <Button variant="danger" onClick={steal}>
            {t("steal")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
