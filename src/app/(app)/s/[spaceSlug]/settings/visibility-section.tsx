"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateSpace } from "@/actions/space";
import type { SpaceVisibility } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

const OPTIONS: { value: SpaceVisibility; labelKey: string; hintKey: string; impactKey: string }[] = [
  {
    value: "private",
    labelKey: "visibilityPrivate",
    hintKey: "visibilityPrivateHint",
    impactKey: "visibilityImpactPrivate",
  },
  {
    value: "org_read",
    labelKey: "visibilityOrgRead",
    hintKey: "visibilityOrgReadHint",
    impactKey: "visibilityImpactOrgRead",
  },
  {
    value: "org_write",
    labelKey: "visibilityOrgWrite",
    hintKey: "visibilityOrgWriteHint",
    impactKey: "visibilityImpactOrgWrite",
  },
];

/** ① 可見性三態 radio（設計規範 §3.10）；變更時以 confirm modal 說明影響範圍後才套用。 */
export function VisibilitySection({
  spaceId,
  visibility,
}: {
  spaceId: string;
  visibility: SpaceVisibility;
}) {
  const t = useTranslations("spaceSettings");
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState<SpaceVisibility>(visibility);
  const [target, setTarget] = useState<SpaceVisibility | null>(null);
  const [pending, startTransition] = useTransition();

  const targetOption = OPTIONS.find((o) => o.value === target);

  function onConfirm() {
    if (!target) return;
    startTransition(async () => {
      try {
        await updateSpace({ spaceId, visibility: target });
        setCurrent(target);
        setTarget(null);
        toast({ variant: "success", title: t("visibilityUpdated") });
        router.refresh();
      } catch {
        setTarget(null);
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <section id="visibility" aria-labelledby="visibility-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="visibility-heading" className="text-h4 text-fg">
          {t("visibilityHeading")}
        </h2>
        <p className="text-body-ui text-fg-secondary">{t("visibilityDesc")}</p>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border border-edge bg-raised p-4">
        <legend className="sr-only">{t("visibilityHeading")}</legend>
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-sm px-2 py-2 transition-colors hover:bg-hover"
          >
            <input
              type="radio"
              name="visibility"
              value={option.value}
              checked={current === option.value}
              disabled={pending}
              onChange={() => {
                if (option.value !== current) setTarget(option.value);
              }}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="flex flex-col">
              <span className="text-body-ui text-fg">{t(option.labelKey)}</span>
              <span className="text-caption text-fg-tertiary">{t(option.hintKey)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <Modal open={target !== null} onOpenChange={(open) => (!open ? setTarget(null) : undefined)}>
        <ModalContent size="sm" title={t("visibilityConfirmTitle")} closeLabel={t("cancel")}>
          <div className="flex flex-col gap-4">
            <p className="text-body-ui text-fg-secondary">
              {targetOption ? t("visibilityConfirmTo", { label: t(targetOption.labelKey) }) : ""}
              {targetOption ? ` ${t(targetOption.impactKey)}` : ""}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setTarget(null)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button loading={pending} onClick={onConfirm}>
                {t("visibilityConfirm")}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </section>
  );
}
