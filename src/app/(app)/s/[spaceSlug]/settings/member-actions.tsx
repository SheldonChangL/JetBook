"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2, UserPlus } from "lucide-react";
import { setSpaceMember } from "@/actions/space";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Modal, ModalContent } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";

/** 成員管理互動島（設計規範 §3.10）：加入成員、角色即時變更（含四級說明）、移除。 */

type Role = "admin" | "editor" | "commenter" | "viewer";

const ROLE_OPTIONS: { value: Role; labelKey: string; hintKey: string }[] = [
  { value: "admin", labelKey: "roleAdmin", hintKey: "roleAdminHint" },
  { value: "editor", labelKey: "roleEditor", hintKey: "roleEditorHint" },
  { value: "commenter", labelKey: "roleCommenter", hintKey: "roleCommenterHint" },
  { value: "viewer", labelKey: "roleViewer", hintKey: "roleViewerHint" },
];

interface Candidate {
  id: string;
  name: string;
  email: string;
}

/** 角色說明下拉選項（加入列與成員列共用）。 */
function RoleSelectItems({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <SelectContent>
      {ROLE_OPTIONS.map((option) => (
        <SelectItem key={option.value} value={option.value} description={t(option.hintKey)}>
          {t(option.labelKey)}
        </SelectItem>
      ))}
    </SelectContent>
  );
}

/** ② 邀請列：搜尋全體使用者 combobox＋角色下拉＋加入。 */
export function AddMemberForm({ spaceId, candidates }: { spaceId: string; candidates: Candidate[] }) {
  const t = useTranslations("spaceSettings");
  const router = useRouter();
  const toast = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("viewer");
  const [pending, startTransition] = useTransition();

  const options: ComboboxOption[] = useMemo(
    () => candidates.map((c) => ({ value: c.id, label: `${c.name}（${c.email}）` })),
    [candidates],
  );

  function onAdd() {
    if (!userId) return;
    startTransition(async () => {
      try {
        await setSpaceMember({ spaceId, userId, role });
        setUserId(null);
        setRole("viewer");
        toast({ variant: "success", title: t("memberAdded") });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-caption text-fg-tertiary">{t("inviteLabel")}</span>
        <Combobox
          options={options}
          value={userId}
          onValueChange={setUserId}
          placeholder={t("invitePlaceholder")}
          searchPlaceholder={t("inviteSearchPlaceholder")}
          emptyText={t("inviteEmpty")}
          disabled={pending}
        />
      </div>
      <div className="flex flex-col gap-1 sm:w-44">
        <span className="text-caption text-fg-tertiary">{t("inviteRoleLabel")}</span>
        <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={pending}>
          <SelectTrigger aria-label={t("inviteRoleLabel")}>
            <SelectValue />
          </SelectTrigger>
          <RoleSelectItems t={t} />
        </Select>
      </div>
      <Button onClick={onAdd} loading={pending} disabled={!userId}>
        <UserPlus aria-hidden className="size-4" />
        {t("addButton")}
      </Button>
    </div>
  );
}

/** ③ 成員列角色下拉（即時變更）；最後一位 admin 停用＋tooltip，自我降權需 confirm。 */
export function MemberRoleSelect({
  spaceId,
  userId,
  role,
  isLastAdmin,
  isSelf,
}: {
  spaceId: string;
  userId: string;
  role: Role;
  isLastAdmin: boolean;
  isSelf: boolean;
}) {
  const t = useTranslations("spaceSettings");
  const router = useRouter();
  const toast = useToast();
  const [confirmTarget, setConfirmTarget] = useState<Role | null>(null);
  const [pending, startTransition] = useTransition();

  function apply(next: Role) {
    startTransition(async () => {
      try {
        await setSpaceMember({ spaceId, userId, role: next });
        toast({ variant: "success", title: t("roleUpdated") });
        router.refresh();
      } catch (err) {
        const isLast = err instanceof Error && err.message.includes("LAST_ADMIN");
        toast({ variant: "error", title: isLast ? t("lastAdminError") : t("actionError") });
      }
    });
  }

  function onChange(next: string) {
    const nextRole = next as Role;
    if (nextRole === role) return;
    // 自我降權（admin → 較低角色）需確認
    if (isSelf && role === "admin" && nextRole !== "admin") {
      setConfirmTarget(nextRole);
      return;
    }
    apply(nextRole);
  }

  const select = (
    <Select value={role} onValueChange={onChange} disabled={pending || isLastAdmin}>
      <SelectTrigger aria-label={t("roleLabel")} className="h-8 w-32 text-caption">
        <SelectValue />
      </SelectTrigger>
      <RoleSelectItems t={t} />
    </Select>
  );

  return (
    <>
      {isLastAdmin ? (
        <Tooltip content={t("lastAdminTooltip")}>
          <span className="inline-block">{select}</span>
        </Tooltip>
      ) : (
        select
      )}

      <Modal
        open={confirmTarget !== null}
        onOpenChange={(open) => (!open ? setConfirmTarget(null) : undefined)}
      >
        <ModalContent size="sm" title={t("selfDemoteTitle")} closeLabel={t("cancel")}>
          <div className="flex flex-col gap-4">
            <p className="text-body-ui text-fg-secondary">{t("selfDemoteBody")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmTarget(null)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button
                variant="danger"
                loading={pending}
                onClick={() => {
                  const next = confirmTarget;
                  setConfirmTarget(null);
                  if (next) apply(next);
                }}
              >
                {t("selfDemoteConfirm")}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}

/** ③ 成員移除鈕；最後一位 admin 停用＋tooltip；移除前 confirm。 */
export function RemoveMemberButton({
  spaceId,
  userId,
  name,
  isLastAdmin,
}: {
  spaceId: string;
  userId: string;
  name: string;
  isLastAdmin: boolean;
}) {
  const t = useTranslations("spaceSettings");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      try {
        await setSpaceMember({ spaceId, userId, role: null });
        setOpen(false);
        toast({ variant: "success", title: t("memberRemoved") });
        router.refresh();
      } catch (err) {
        setOpen(false);
        const isLast = err instanceof Error && err.message.includes("LAST_ADMIN");
        toast({ variant: "error", title: isLast ? t("lastAdminError") : t("actionError") });
      }
    });
  }

  if (isLastAdmin) {
    return (
      <Tooltip content={t("lastAdminTooltip")}>
        <span className="inline-block">
          <Button variant="ghost" size="sm" disabled aria-label={t("remove")}>
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </span>
      </Tooltip>
    );
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={t("remove")}>
        <Trash2 aria-hidden className="size-4" />
      </Button>
      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent size="sm" title={t("removeConfirmTitle")} closeLabel={t("cancel")}>
          <div className="flex flex-col gap-4">
            <p className="text-body-ui text-fg-secondary">{t("removeConfirmBody", { name })}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button variant="danger" loading={pending} onClick={onConfirm}>
                {t("removeConfirm")}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}
