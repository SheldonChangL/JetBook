"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArchiveRestore } from "lucide-react";
import { restoreSpaceAction } from "@/actions/space";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** 還原軟刪空間（org admin）：呼叫 restoreSpaceAction，成功刷新列表。 */
export function RestoreSpaceButton({ spaceId }: { spaceId: string }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function onRestore() {
    startTransition(async () => {
      try {
        const result = await restoreSpaceAction({ spaceId });
        if (result.ok) {
          toast({ variant: "success", title: t("spacesRestored") });
        } else {
          toast({ variant: "error", title: t("spacesRestoreExpired") });
        }
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
      router.refresh();
    });
  }

  return (
    <Button size="sm" variant="secondary" loading={pending} onClick={onRestore}>
      <ArchiveRestore aria-hidden className="size-3.5" />
      {t("spacesRestore")}
    </Button>
  );
}
