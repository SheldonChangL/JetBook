"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { createUserAction } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

/** 建立使用者 Modal（F-ADMIN-01）：姓名/email/初始密碼/系統角色。 */
export function CreateUserButton() {
  const t = useTranslations("admin");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [orgRole, setOrgRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setError(null);
      setOrgRole("member");
    }
  }

  function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    if (!name || !email || !password) return;
    startTransition(async () => {
      try {
        const result = await createUserAction({ name, email, password, orgRole });
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
          {t("createUser")}
        </Button>
      </ModalTrigger>
      <ModalContent
        size="sm"
        title={t("createUserTitle")}
        closeLabel={t("cancel")}
        className="archive-admin-modal"
      >
        <form action={onSubmit} className="flex flex-col gap-4">
          <Input name="name" label={t("fieldName")} required maxLength={100} autoFocus />
          <Input
            name="email"
            type="email"
            label={t("fieldEmail")}
            required
            maxLength={254}
            error={error === "EMAIL_TAKEN" ? t("errorEmailTaken") : undefined}
          />
          <Input
            name="password"
            type="text"
            label={t("fieldPassword")}
            helper={t("fieldPasswordHelper")}
            required
            minLength={10}
            maxLength={128}
            autoComplete="off"
            error={error === "WEAK_PASSWORD" ? t("errorWeakPassword") : undefined}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-body-ui font-medium text-fg">{t("fieldOrgRole")}</span>
            <Select value={orgRole} onValueChange={(v) => setOrgRole(v as "admin" | "member")}>
              <SelectTrigger aria-label={t("fieldOrgRole")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{t("role.member")}</SelectItem>
                <SelectItem value="admin">{t("role.admin")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="submit" loading={pending}>
              {t("createUser")}
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}
