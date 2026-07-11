"use client";

import { useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

/**
 * 閱讀端圖片（G-02 / D-07）：max-width 100%，點擊開 lightbox 放大檢視。
 * lightbox 用 Radix Dialog（focus trap、Esc 關閉、鎖捲動）；圖說取 alt。
 */
export function ContentImage({ src, alt }: { src: string; alt: string }) {
  const t = useTranslations("reading.image");
  const [open, setOpen] = useState(false);

  return (
    <figure className="content-image-figure">
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
          <button type="button" className="content-image-trigger" aria-label={t("zoom")}>
            {/* 使用者上傳圖片經 /api/files 動態提供，不走 next/image 最佳化 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="content-image" />
          </button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <DialogPrimitive.Title className="sr-only">
              {alt || t("preview")}
            </DialogPrimitive.Title>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="content-image-lightbox-img" />
            <DialogPrimitive.Close
              aria-label={t("close")}
              className="fixed right-4 top-4 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
            >
              <X aria-hidden className="size-5" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      {alt ? <figcaption className="content-image-caption">{alt}</figcaption> : null}
    </figure>
  );
}
