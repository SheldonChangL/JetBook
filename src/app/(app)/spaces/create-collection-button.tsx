"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FolderPlus } from "lucide-react";
import { createCollectionAction } from "@/actions/collection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/** 建立 Collection 分組（C-09，org admin）。 */
export function CreateCollectionButton() {
  const t = useTranslations("spaces");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const result = await createCollectionAction({ name });
        if (!result.ok) {
          toast({ variant: "error", title: t("collectionActionError") });
          return;
        }
        setOpen(false);
        toast({ variant: "success", title: t("collectionCreateSuccess") });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("collectionActionError") });
      }
    });
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button variant="secondary">
          <FolderPlus aria-hidden className="size-4" />
          {t("createCollection")}
        </Button>
      </ModalTrigger>
      <ModalContent size="sm" title={t("createCollectionTitle")} closeLabel={t("cancel")}>
        <form action={onSubmit} className="flex flex-col gap-4">
          <Input name="name" label={t("collectionNameLabel")} required maxLength={80} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("createCollection")}
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}
