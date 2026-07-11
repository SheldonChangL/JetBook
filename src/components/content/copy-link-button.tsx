"use client";

import { Link as LinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { copyPageLink } from "@/components/content/copy-link";

/**
 * 閱讀頁動作列「複製連結」鈕（G-05）：複製當前頁面完整 URL（不含錨點）並 toast。
 */
export function CopyLinkButton() {
  const t = useTranslations("reading");
  const toast = useToast();

  async function onCopy() {
    const ok = await copyPageLink();
    toast(
      ok
        ? { variant: "success", title: t("linkCopied") }
        : { variant: "error", title: t("copyFailed") },
    );
  }

  return (
    <Button variant="ghost" size="sm" onClick={onCopy}>
      <LinkIcon aria-hidden className="size-4" />
      {t("copyLink")}
    </Button>
  );
}
