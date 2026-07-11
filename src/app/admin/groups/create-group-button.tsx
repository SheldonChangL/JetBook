"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { createGroupAction } from "@/actions/group";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/** 建立群組 Modal（F-ADMIN-02）：名稱＋描述。 */
export function CreateGroupButton() {
  const t = useTranslations("adminGroups");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setError(null);
  }

  function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const result = await createGroupAction({ name, description: description || null });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOpen(false);
        toast({ variant: "success", title: t("createSuccess") });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalTrigger asChild>
        <Button>
          <Plus aria-hidden className="size-4" />
          {t("createGroup")}
        </Button>
      </ModalTrigger>
      <ModalContent size="sm" title={t("createGroupTitle")} closeLabel={t("cancel")}>
        <form action={onSubmit} className="flex flex-col gap-4">
          <Input
            name="name"
            label={t("fieldName")}
            required
            maxLength={80}
            error={error === "NAME_TAKEN" ? t("errorNameTaken") : undefined}
          />
          <Textarea name="description" label={t("fieldDescription")} maxLength={300} rows={3} />
          <div className="flex justify-end gap-2">
            <Button type="submit" loading={pending}>
              {t("createGroup")}
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}
