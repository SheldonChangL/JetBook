"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { deleteSpace } from "@/actions/space";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * 軟刪除空間（deleted_at）：刪除後空間與其所有頁面自列表、搜尋、AI 隱藏，
 * 30 天內可由系統管理員於後台還原，逾期永久清除。刪除成功後導回空間列表。
 */
export function DeleteSection({ spaceId, spaceName }: { spaceId: string; spaceName: string }) {
  const t = useTranslations("spaceSettings");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      try {
        await deleteSpace({ spaceId });
        toast({ variant: "success", title: t("deleted") });
        router.replace("/spaces");
      } catch {
        setOpen(false);
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <section aria-labelledby="delete-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="delete-heading" className="text-h4 text-danger">
          {t("deleteHeading")}
        </h2>
        <p className="text-body-ui text-fg-secondary">{t("deleteDesc")}</p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border border-danger/40 bg-raised p-4">
        <span className="text-body-ui text-fg-secondary">{spaceName}</span>
        <Button variant="danger" onClick={() => setOpen(true)}>
          <Trash2 aria-hidden className="size-4" />
          {t("deleteButton")}
        </Button>
      </div>

      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent size="sm" title={t("deleteConfirmTitle")} closeLabel={t("cancel")}>
          <div className="flex flex-col gap-4">
            <p className="text-body-ui text-fg-secondary">
              {t("deleteConfirmBody", { name: spaceName })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button variant="danger" loading={pending} onClick={onConfirm}>
                {t("deleteConfirm")}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </section>
  );
}
