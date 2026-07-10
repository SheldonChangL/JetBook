"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { History } from "lucide-react";
import { restorePageVersion } from "@/actions/page";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * [還原此版本]（E-03，設計規範 §3.8）：editor+ 才由 server component 渲染本元件。
 * confirm modal 說明「還原會建立新版本而非覆蓋」→ restorePageVersion → toast ＋導回閱讀頁。
 */
export function RestoreVersionButton({
  pageId,
  versionNo,
  readingHref,
}: {
  pageId: string;
  versionNo: number;
  readingHref: string;
}) {
  const t = useTranslations("versionHistory");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      try {
        const { versionNo: newVersionNo } = await restorePageVersion({ pageId, versionNo });
        setOpen(false);
        toast({
          variant: "success",
          title: t("restoreSuccess", { n: versionNo, newN: newVersionNo }),
        });
        router.push(readingHref);
        // 閱讀頁可能已有 RSC 快取，強制重新取得還原後內容
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("restoreError") });
      }
    });
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button variant="secondary" size="sm">
          <History aria-hidden className="size-4" />
          {t("restore")}
        </Button>
      </ModalTrigger>
      <ModalContent
        size="sm"
        title={t("restoreModalTitle", { n: versionNo })}
        description={t("restoreModalBody", { n: versionNo })}
        closeLabel={t("restoreCancel")}
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            {t("restoreCancel")}
          </Button>
          <Button onClick={onConfirm} loading={pending}>
            {t("restoreConfirm")}
          </Button>
        </div>
      </ModalContent>
    </Modal>
  );
}
