"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateProfileAction } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/** ① 基本資料：顯示名稱（email 唯讀）。 */
export function ProfileSection({ name, email }: { name: string; email: string }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(name);
  const [pending, startTransition] = useTransition();

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 100 && trimmed !== name;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    startTransition(async () => {
      const result = await updateProfileAction({ name: trimmed });
      if (result.ok) {
        toast({ variant: "success", title: t("profileUpdated") });
        router.refresh();
      } else {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <section aria-labelledby="profile-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="profile-heading" className="text-h4 text-fg">
          {t("profileHeading")}
        </h2>
        <p className="text-body-ui text-fg-secondary">{t("profileDesc")}</p>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-md border border-edge bg-raised p-4"
      >
        <Input label={t("emailLabel")} value={email} readOnly disabled />
        <Input
          label={t("displayNameLabel")}
          value={value}
          maxLength={100}
          required
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" loading={pending} disabled={!canSave}>
            {t("save")}
          </Button>
        </div>
      </form>
    </section>
  );
}
