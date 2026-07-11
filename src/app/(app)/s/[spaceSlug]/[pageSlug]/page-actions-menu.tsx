"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Download, Ellipsis } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * 閱讀頁「⋯ 更多動作」選單（J-03）：
 * - 複製為 Markdown：fetch 單頁 md（/api/pages/[id]/markdown）→ 寫入剪貼簿。
 * - 下載 .md：以匿名 anchor 觸發下載（檔名由 route 的 Content-Disposition 決定）。
 * 權限（page.read）由 route 薄殼把關；前端僅發起請求。
 */
export function PageActionsMenu({ pageId }: { pageId: string }) {
  const t = useTranslations("reading");
  const toast = useToast();
  const [copying, setCopying] = useState(false);

  const markdownUrl = `/api/pages/${pageId}/markdown`;

  async function onCopyMarkdown() {
    if (copying) return;
    setCopying(true);
    try {
      const res = await fetch(markdownUrl, { cache: "no-store" });
      if (!res.ok) throw new Error("markdown fetch failed");
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      toast({ variant: "success", title: t("markdownCopied") });
    } catch {
      toast({ variant: "error", title: t("markdownCopyFailed") });
    } finally {
      setCopying(false);
    }
  }

  function onDownloadMarkdown() {
    const a = document.createElement("a");
    a.href = markdownUrl;
    a.rel = "noopener";
    // 檔名由 route 的 Content-Disposition 決定；download 屬性僅作提示。
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("moreActions")}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "px-2")}
      >
        <Ellipsis aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          disabled={copying}
          onSelect={(e) => {
            e.preventDefault(); // 保持選單邏輯，非同步複製自行關閉
            void onCopyMarkdown();
          }}
        >
          <Copy aria-hidden className="size-4" />
          {t("copyMarkdown")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDownloadMarkdown}>
          <Download aria-hidden className="size-4" />
          {t("downloadMarkdown")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
