"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Trash2 } from "lucide-react";
import { deleteCollectionAction, renameCollectionAction } from "@/actions/collection";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal, ModalContent } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/** Collection 列操作（C-09，org admin）：重新命名、刪除（含確認）。 */
export function CollectionActions({ collectionId, name }: { collectionId: string; name: string }) {
  const t = useTranslations("spaces");
  const router = useRouter();
  const toast = useToast();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onRename(formData: FormData) {
    const nextName = String(formData.get("name") ?? "").trim();
    if (!nextName) return;
    startTransition(async () => {
      try {
        const result = await renameCollectionAction({ collectionId, name: nextName });
        if (!result.ok) {
          toast({ variant: "error", title: t("collectionActionError") });
          return;
        }
        setRenameOpen(false);
        toast({ variant: "success", title: t("collectionRenameSuccess") });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("collectionActionError") });
      }
    });
  }

  function onDelete() {
    startTransition(async () => {
      try {
        const result = await deleteCollectionAction({ collectionId });
        if (!result.ok) {
          toast({ variant: "error", title: t("collectionActionError") });
          return;
        }
        setDeleteOpen(false);
        toast({ variant: "success", title: t("collectionDeleteSuccess") });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("collectionActionError") });
      }
    });
  }

  return (
    <>
      <div className="flex items-center gap-0.5">
        <IconButton label={t("renameCollection")} onClick={() => setRenameOpen(true)}>
          <Pencil className="size-4" />
        </IconButton>
        <IconButton label={t("deleteCollection")} onClick={() => setDeleteOpen(true)}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>

      <Modal open={renameOpen} onOpenChange={setRenameOpen}>
        <ModalContent size="sm" title={t("renameCollectionTitle")} closeLabel={t("cancel")}>
          <form action={onRename} className="flex flex-col gap-4">
            <Input
              name="name"
              label={t("collectionNameLabel")}
              defaultValue={name}
              required
              maxLength={80}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRenameOpen(false)}
                disabled={pending}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" loading={pending}>
                {t("save")}
              </Button>
            </div>
          </form>
        </ModalContent>
      </Modal>

      <Modal open={deleteOpen} onOpenChange={setDeleteOpen}>
        <ModalContent size="sm" title={t("deleteCollectionTitle")} closeLabel={t("cancel")}>
          <div className="flex flex-col gap-4">
            <p className="text-body-ui text-fg-secondary">{t("deleteCollectionBody", { name })}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button variant="danger" loading={pending} onClick={onDelete}>
                {t("deleteCollection")}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}
