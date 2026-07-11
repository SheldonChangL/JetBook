"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2, UsersRound } from "lucide-react";
import { setSpaceGroup } from "@/actions/space";
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
import { useToast } from "@/components/ui/toast";

/** 群組掛載互動島（K-03 主體泛化）：掛群組＋角色、角色即時變更、移除掛載。 */

type Role = "admin" | "editor" | "commenter" | "viewer";

const ROLE_OPTIONS: { value: Role; labelKey: string; hintKey: string }[] = [
  { value: "admin", labelKey: "roleAdmin", hintKey: "roleAdminHint" },
  { value: "editor", labelKey: "roleEditor", hintKey: "roleEditorHint" },
  { value: "commenter", labelKey: "roleCommenter", hintKey: "roleCommenterHint" },
  { value: "viewer", labelKey: "roleViewer", hintKey: "roleViewerHint" },
];

interface GroupCandidate {
  id: string;
  name: string;
}

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

/** 掛群組列：搜尋群組 combobox＋角色下拉＋掛載。 */
export function AddSpaceGroupForm({
  spaceId,
  candidates,
}: {
  spaceId: string;
  candidates: GroupCandidate[];
}) {
  const t = useTranslations("spaceSettings");
  const router = useRouter();
  const toast = useToast();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("viewer");
  const [pending, startTransition] = useTransition();

  const options: ComboboxOption[] = useMemo(
    () => candidates.map((c) => ({ value: c.id, label: c.name })),
    [candidates],
  );

  function onAdd() {
    if (!groupId) return;
    startTransition(async () => {
      try {
        await setSpaceGroup({ spaceId, groupId, role });
        setGroupId(null);
        setRole("viewer");
        toast({ variant: "success", title: t("groupAdded") });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-caption text-fg-tertiary">{t("attachGroupLabel")}</span>
        <Combobox
          options={options}
          value={groupId}
          onValueChange={setGroupId}
          placeholder={t("attachGroupPlaceholder")}
          searchPlaceholder={t("attachGroupSearchPlaceholder")}
          emptyText={t("attachGroupEmpty")}
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
      <Button onClick={onAdd} loading={pending} disabled={!groupId}>
        <UsersRound aria-hidden className="size-4" />
        {t("attachButton")}
      </Button>
    </div>
  );
}

/** 掛載群組角色下拉（即時變更）。 */
export function SpaceGroupRoleSelect({
  spaceId,
  groupId,
  role,
}: {
  spaceId: string;
  groupId: string;
  role: Role;
}) {
  const t = useTranslations("spaceSettings");
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    const nextRole = next as Role;
    if (nextRole === role) return;
    startTransition(async () => {
      try {
        await setSpaceGroup({ spaceId, groupId, role: nextRole });
        toast({ variant: "success", title: t("roleUpdated") });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <Select value={role} onValueChange={onChange} disabled={pending}>
      <SelectTrigger aria-label={t("roleLabel")} className="h-8 w-32 text-caption">
        <SelectValue />
      </SelectTrigger>
      <RoleSelectItems t={t} />
    </Select>
  );
}

/** 移除群組掛載鈕（含確認）。 */
export function RemoveSpaceGroupButton({
  spaceId,
  groupId,
  name,
}: {
  spaceId: string;
  groupId: string;
  name: string;
}) {
  const t = useTranslations("spaceSettings");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      try {
        await setSpaceGroup({ spaceId, groupId, role: null });
        setOpen(false);
        toast({ variant: "success", title: t("groupRemoved") });
        router.refresh();
      } catch {
        setOpen(false);
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={t("groupRemove")}>
        <Trash2 aria-hidden className="size-4" />
      </Button>
      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent size="sm" title={t("groupRemoveConfirmTitle")} closeLabel={t("cancel")}>
          <div className="flex flex-col gap-4">
            <p className="text-body-ui text-fg-secondary">
              {t("groupRemoveConfirmBody", { name })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button variant="danger" loading={pending} onClick={onConfirm}>
                {t("groupRemove")}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}
