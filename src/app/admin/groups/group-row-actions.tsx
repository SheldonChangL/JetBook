"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Trash2 } from "lucide-react";
import { deleteGroupAction, updateGroupAction } from "@/actions/group";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Modal, ModalContent } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/** 群組列操作（F-ADMIN-02）：重新命名（名稱／描述）、刪除（含確認）。 */
export function GroupRowActions({
  groupId,
  name,
  description,
}: {
  groupId: string;
  name: string;
  description: string | null;
}) {
  const t = useTranslations("adminGroups");
  const router = useRouter();
  const toast = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onEditOpenChange(next: boolean) {
    setEditOpen(next);
    if (next) setError(null);
  }

  function onSave(formData: FormData) {
    const nextName = String(formData.get("name") ?? "").trim();
    const nextDescription = String(formData.get("description") ?? "").trim();
    if (!nextName) return;
    startTransition(async () => {
      try {
        const result = await updateGroupAction({
          groupId,
          name: nextName,
          description: nextDescription || null,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setEditOpen(false);
        toast({ variant: "success", title: t("updateSuccess") });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  function onDelete() {
    startTransition(async () => {
      try {
        const result = await deleteGroupAction({ groupId });
        if (!result.ok) {
          toast({ variant: "error", title: t("actionError") });
          return;
        }
        setDeleteOpen(false);
        toast({ variant: "success", title: t("deleteSuccess") });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onEditOpenChange(true)}
        aria-label={t("edit")}
      >
        <Pencil aria-hidden className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setDeleteOpen(true)}
        aria-label={t("delete")}
      >
        <Trash2 aria-hidden className="size-4" />
      </Button>

      <Modal open={editOpen} onOpenChange={onEditOpenChange}>
        <ModalContent
          size="sm"
          title={t("editGroupTitle")}
          closeLabel={t("cancel")}
          className="archive-admin-modal"
        >
          <form action={onSave} className="flex flex-col gap-4">
            <Input
              name="name"
              label={t("fieldName")}
              defaultValue={name}
              required
              maxLength={80}
              autoFocus
              error={error === "NAME_TAKEN" ? t("errorNameTaken") : undefined}
            />
            <Textarea
              name="description"
              label={t("fieldDescription")}
              defaultValue={description ?? ""}
              maxLength={300}
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditOpen(false)}
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
        <ModalContent
          size="sm"
          title={t("deleteGroupTitle")}
          closeLabel={t("cancel")}
          className="archive-admin-modal"
        >
          <div className="flex flex-col gap-4">
            <p className="text-body-ui text-fg-secondary">{t("deleteConfirmBody", { name })}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button variant="danger" loading={pending} onClick={onDelete}>
                {t("delete")}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}
