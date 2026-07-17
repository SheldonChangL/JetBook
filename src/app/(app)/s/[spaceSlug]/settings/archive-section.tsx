"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore } from "lucide-react";
import { archiveSpace } from "@/actions/space";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/** 封存/取消封存空間（archived_at）；封存後自列表與搜尋隱藏，內容保留可還原。 */
export function ArchiveSection({
  spaceId,
  spaceName,
  archived,
}: {
  spaceId: string;
  spaceName: string;
  archived: boolean;
}) {
  const t = useTranslations("spaceSettings");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      try {
        await archiveSpace({ spaceId, archived: !archived });
        setOpen(false);
        toast({ variant: "success", title: archived ? t("unarchived") : t("archived") });
        router.refresh();
      } catch {
        setOpen(false);
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <section id="archive" aria-labelledby="archive-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="archive-heading" className="text-h4 text-fg">
          {t("archiveHeading")}
        </h2>
        <p className="text-body-ui text-fg-secondary">{t("archiveDesc")}</p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border border-edge bg-raised p-4">
        <span className="text-body-ui text-fg-secondary">{spaceName}</span>
        <Button
          variant={archived ? "secondary" : "danger"}
          onClick={() => setOpen(true)}
        >
          {archived ? (
            <ArchiveRestore aria-hidden className="size-4" />
          ) : (
            <Archive aria-hidden className="size-4" />
          )}
          {archived ? t("unarchiveButton") : t("archiveButton")}
        </Button>
      </div>

      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent
          size="sm"
          title={archived ? t("unarchiveConfirmTitle") : t("archiveConfirmTitle")}
          closeLabel={t("cancel")}
        >
          <div className="flex flex-col gap-4">
            <p className="text-body-ui text-fg-secondary">
              {archived
                ? t("unarchiveConfirmBody", { name: spaceName })
                : t("archiveConfirmBody", { name: spaceName })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button
                variant={archived ? "primary" : "danger"}
                loading={pending}
                onClick={onConfirm}
              >
                {archived ? t("unarchiveConfirm") : t("archiveConfirm")}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </section>
  );
}
