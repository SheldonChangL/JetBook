"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateSpace } from "@/actions/space";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { EmojiPickerButton } from "@/components/ui/emoji-picker";
import { useToast } from "@/components/ui/toast";

/** 一般資訊區塊（M4-03）：名稱／描述／emoji 圖示，經 updateSpace（space.manage 權限）。 */
export function GeneralSection({
  spaceId,
  initialName,
  initialDescription,
  initialIcon,
}: {
  spaceId: string;
  initialName: string;
  initialDescription: string | null;
  initialIcon: string | null;
}) {
  const t = useTranslations("spaceSettings");
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [pending, startTransition] = useTransition();

  const dirty =
    name.trim() !== initialName ||
    description.trim() !== (initialDescription ?? "") ||
    icon !== initialIcon;

  function onSave() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    startTransition(async () => {
      try {
        await updateSpace({
          spaceId,
          name: trimmedName,
          description: description.trim() || null,
          icon,
        });
        toast({ variant: "success", title: t("generalUpdated") });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("generalUpdateError") });
      }
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border border-edge p-5">
      <div>
        <h2 className="text-h3 text-fg">{t("generalTitle")}</h2>
        <p className="text-body-ui text-fg-secondary">{t("generalDesc")}</p>
      </div>
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-body-ui font-medium text-fg">{t("generalIcon")}</span>
          <EmojiPickerButton value={icon} onChange={setIcon} ariaLabel={t("generalIcon")} />
        </div>
        <div className="flex-1">
          <Input
            label={t("generalName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
        </div>
      </div>
      <Textarea
        label={t("generalDescription")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
        rows={3}
      />
      <div className="flex justify-end">
        <Button onClick={onSave} loading={pending} disabled={!dirty || !name.trim()}>
          {t("generalSave")}
        </Button>
      </div>
    </section>
  );
}
