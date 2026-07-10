"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { createSpace } from "@/actions/space";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

export function CreateSpaceButton() {
  const t = useTranslations("spaces");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const icon = String(formData.get("icon") ?? "").trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const { slug } = await createSpace({
          name,
          description: description || undefined,
          icon: icon || undefined,
        });
        setOpen(false);
        router.push(`/s/${slug}`);
      } catch {
        toast({ variant: "error", title: t("createError") });
      }
    });
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button>
          <Plus aria-hidden className="size-4" />
          {t("create")}
        </Button>
      </ModalTrigger>
      <ModalContent size="sm" title={t("createTitle")} closeLabel={t("cancel")}>
        <form action={onSubmit} className="flex flex-col gap-4">
          <Input name="name" label={t("nameLabel")} required maxLength={100} />
          <Input name="icon" label={t("iconLabel")} maxLength={16} placeholder="📘" />
          <Textarea name="description" label={t("descLabel")} rows={2} maxLength={500} />
          <div className="flex justify-end gap-2">
            <Button type="submit" loading={pending}>
              {t("create")}
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}
