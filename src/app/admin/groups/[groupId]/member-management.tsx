"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2, Upload, UserPlus } from "lucide-react";
import {
  addGroupMemberAction,
  importGroupMembersAction,
  removeGroupMemberAction,
} from "@/actions/group";
import type { ImportEmailsResult } from "@/lib/admin/groups";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/input";
import { Modal, ModalContent } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

interface Candidate {
  id: string;
  name: string;
  email: string;
}

/** 加入成員列：搜尋全體使用者 combobox＋加入（K-03，F-ADMIN-02）。 */
export function AddGroupMemberForm({
  groupId,
  candidates,
}: {
  groupId: string;
  candidates: Candidate[];
}) {
  const t = useTranslations("adminGroups");
  const router = useRouter();
  const toast = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options: ComboboxOption[] = useMemo(
    () => candidates.map((c) => ({ value: c.id, label: `${c.name}（${c.email}）` })),
    [candidates],
  );

  function onAdd() {
    if (!userId) return;
    startTransition(async () => {
      try {
        await addGroupMemberAction({ groupId, userId });
        setUserId(null);
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
        <span className="text-caption text-fg-tertiary">{t("addMemberLabel")}</span>
        <Combobox
          options={options}
          value={userId}
          onValueChange={setUserId}
          placeholder={t("addMemberPlaceholder")}
          searchPlaceholder={t("addMemberSearchPlaceholder")}
          emptyText={t("addMemberEmpty")}
          disabled={pending}
        />
      </div>
      <Button onClick={onAdd} loading={pending} disabled={!userId}>
        <UserPlus aria-hidden className="size-4" />
        {t("addButton")}
      </Button>
    </div>
  );
}

/** CSV 批次貼上 email 匯入（F-ADMIN-02）：貼上 email 清單 → 匯入 → 回報結果。 */
export function CsvImportForm({ groupId }: { groupId: string }) {
  const t = useTranslations("adminGroups");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<ImportEmailsResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setText("");
      setResult(null);
    }
  }

  function onImport() {
    if (!text.trim()) return;
    startTransition(async () => {
      try {
        const res = await importGroupMembersAction({ groupId, text });
        if (!res.ok) {
          toast({ variant: "error", title: t("actionError") });
          return;
        }
        setResult(res.result);
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => onOpenChange(true)}>
        <Upload aria-hidden className="size-4" />
        {t("csvImport")}
      </Button>
      <Modal open={open} onOpenChange={onOpenChange}>
        <ModalContent size="md" title={t("csvImportTitle")} closeLabel={t("cancel")}>
          <div className="flex flex-col gap-4">
            <Textarea
              label={t("csvImportLabel")}
              helper={t("csvImportHelper")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              maxLength={50000}
              disabled={pending}
            />

            {result ? (
              <div className="flex flex-col gap-2 rounded-md border border-edge bg-raised px-4 py-3 text-body-ui">
                <p className="text-fg">
                  {t("csvResultSummary", {
                    added: result.added,
                    already: result.alreadyMember,
                  })}
                </p>
                {result.notFound.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-caption text-warning">
                      {t("csvResultNotFound", { count: result.notFound.length })}
                    </span>
                    <span className="break-words text-caption text-fg-tertiary">
                      {result.notFound.join("、")}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
                {result ? t("done") : t("cancel")}
              </Button>
              <Button onClick={onImport} loading={pending} disabled={!text.trim()}>
                {t("csvImportSubmit")}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}

/** 成員移除鈕（含確認）。 */
export function RemoveGroupMemberButton({
  groupId,
  userId,
  name,
}: {
  groupId: string;
  userId: string;
  name: string;
}) {
  const t = useTranslations("adminGroups");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      try {
        await removeGroupMemberAction({ groupId, userId });
        setOpen(false);
        toast({ variant: "success", title: t("memberRemoved") });
        router.refresh();
      } catch {
        setOpen(false);
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={t("remove")}>
        <Trash2 aria-hidden className="size-4" />
      </Button>
      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent size="sm" title={t("removeMemberTitle")} closeLabel={t("cancel")}>
          <div className="flex flex-col gap-4">
            <p className="text-body-ui text-fg-secondary">{t("removeConfirmBody", { name })}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button variant="danger" loading={pending} onClick={onConfirm}>
                {t("remove")}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}
