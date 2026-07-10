"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Copy, KeyRound } from "lucide-react";
import {
  resetUserPasswordAction,
  setUserActiveAction,
  setUserOrgRoleAction,
} from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent } from "@/components/ui/modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

/** 使用者列操作（F-ADMIN-01）：角色切換／停用啟用／強制重設密碼。 */

export function OrgRoleSelect({
  userId,
  orgRole,
}: {
  userId: string;
  orgRole: "admin" | "member";
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    if (next === orgRole) return;
    startTransition(async () => {
      try {
        const result = await setUserOrgRoleAction({
          userId,
          orgRole: next as "admin" | "member",
        });
        if (!result.ok) {
          toast({
            variant: "error",
            title: result.error === "LAST_ORG_ADMIN" ? t("errorLastAdmin") : t("actionError"),
          });
        }
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
      router.refresh();
    });
  }

  return (
    <Select value={orgRole} onValueChange={onChange} disabled={pending}>
      <SelectTrigger aria-label={t("colOrgRole")} className="h-7 w-28 text-caption">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="member">{t("role.member")}</SelectItem>
        <SelectItem value="admin">{t("role.admin")}</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function ActiveToggle({ userId, isActive }: { userId: string; isActive: boolean }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function onToggle() {
    startTransition(async () => {
      try {
        const result = await setUserActiveAction({ userId, isActive: !isActive });
        if (!result.ok) {
          toast({
            variant: "error",
            title: result.error === "LAST_ORG_ADMIN" ? t("errorLastAdmin") : t("actionError"),
          });
        } else if (isActive) {
          toast({ variant: "success", title: t("deactivated") });
        }
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
      router.refresh();
    });
  }

  return (
    <Button
      size="sm"
      variant={isActive ? "danger" : "secondary"}
      loading={pending}
      onClick={onToggle}
    >
      {isActive ? t("deactivate") : t("activate")}
    </Button>
  );
}

export function ResetPasswordButton({ userId, name }: { userId: string; name: string }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setPassword(null);
      router.refresh();
    }
  }

  function onConfirm() {
    startTransition(async () => {
      try {
        const result = await resetUserPasswordAction({ userId });
        if (result.ok) {
          setPassword(result.password);
        } else {
          toast({ variant: "error", title: t("actionError") });
          setOpen(false);
        }
      } catch {
        toast({ variant: "error", title: t("actionError") });
        setOpen(false);
      }
    });
  }

  async function onCopy() {
    if (!password) return;
    await navigator.clipboard.writeText(password);
    toast({ variant: "success", title: t("passwordCopied") });
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => onOpenChange(true)}>
        <KeyRound aria-hidden className="size-3.5" />
        {t("resetPassword")}
      </Button>
      <Modal open={open} onOpenChange={onOpenChange}>
        <ModalContent
          size="sm"
          title={t("resetPasswordTitle", { name })}
          closeLabel={t("cancel")}
        >
          {password ? (
            <div className="flex flex-col gap-4">
              <p className="text-body-ui text-fg-secondary">{t("resetPasswordDone")}</p>
              <div className="flex items-center gap-2 rounded-sm border border-edge bg-sidebar px-3 py-2">
                <code className="flex-1 break-all font-mono text-body-ui text-fg">{password}</code>
                <Button size="sm" variant="ghost" onClick={onCopy}>
                  <Copy aria-hidden className="size-3.5" />
                  {t("copy")}
                </Button>
              </div>
              <p className="text-caption text-warning">{t("resetPasswordOnce")}</p>
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  {t("done")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-body-ui text-fg-secondary">{t("resetPasswordConfirm")}</p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  {t("cancel")}
                </Button>
                <Button variant="danger" loading={pending} onClick={onConfirm}>
                  {t("resetPassword")}
                </Button>
              </div>
            </div>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
