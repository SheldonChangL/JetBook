"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Link2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { copyPageLink } from "@/components/content/copy-link";

/**
 * 標題 hover 複製錨點連結鈕（G-05）。
 * 平時隱藏，滑過標題（group-hover）或鍵盤 focus 時顯示；點擊複製「完整 URL + #錨點」並 toast。
 */
export function HeadingAnchor({ id }: { id: string }) {
  const t = useTranslations("reading");
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    const ok = await copyPageLink(id);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast({ variant: "success", title: t("linkCopied") });
    } else {
      toast({ variant: "error", title: t("copyFailed") });
    }
  }

  return (
    <button
      type="button"
      aria-label={t("copyAnchor")}
      onClick={onCopy}
      className="ml-1.5 inline-flex size-6 -translate-y-0.5 items-center justify-center rounded-xs align-middle text-fg-tertiary opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
    >
      {copied ? (
        <Check aria-hidden className="size-4 text-success" />
      ) : (
        <Link2 aria-hidden className="size-4" />
      )}
    </button>
  );
}
