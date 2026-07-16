"use client";

import { useCallback, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useTranslations } from "next-intl";
import { RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";

/**
 * 閱讀端 Mermaid 圖表放大檢視（#247）。
 * 點擊內嵌圖表 → 開啟 lightbox Modal（Radix Dialog：focus trap／Esc／鎖捲動），
 * Modal 內以純 CSS transform 縮放＋平移（滾輪縮放、拖曳平移、+/− 與重設鈕），
 * 「放大圖表本身」而非依賴瀏覽器整頁縮放，且不影響頁面版面。零新增相依。
 *
 * SVG 由 MermaidDiagram 於 client 端渲染完成後以字串傳入；此處於觸發器與 Modal
 * 各注入一份（dangerouslySetInnerHTML），內容同源、已由 mermaid 產生。
 */

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const STEP = 1.25;

const clampScale = (value: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

export function MermaidZoom({ svg, label }: { svg: string; label: string }) {
  const t = useTranslations("reading.mermaid");
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const reset = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) reset(); // 關閉即重設縮放/平移，下次開啟回到預設
    },
    [reset],
  );

  const zoomIn = useCallback(() => setScale((s) => clampScale(s * STEP)), []);
  const zoomOut = useCallback(() => setScale((s) => clampScale(s / STEP)), []);

  // viewport overflow:hidden，滾輪只調整縮放、不捲動；故無需 preventDefault（避免 passive listener 警告）。
  const onWheel = useCallback((e: React.WheelEvent) => {
    setScale((s) => clampScale(s * (e.deltaY < 0 ? STEP : 1 / STEP)));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { x: e.clientX, y: e.clientY, tx, ty };
    },
    [tx, ty],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start) return;
    setTx(start.tx + (e.clientX - start.x));
    setTy(start.ty + (e.clientY - start.y));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="jb-mermaid__zoom-trigger"
          aria-label={t("zoom")}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="jb-mermaid-zoom__overlay" />
        <DialogPrimitive.Content aria-describedby={undefined} className="jb-mermaid-zoom__content">
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          <div
            className="jb-mermaid-zoom__viewport"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div
              className="jb-mermaid-zoom__stage"
              style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
          <div className="jb-mermaid-zoom__toolbar" role="toolbar" aria-label={label}>
            <button type="button" onClick={zoomOut} aria-label={t("zoomOut")}>
              <ZoomOut aria-hidden className="size-4" />
            </button>
            <span className="jb-mermaid-zoom__scale" aria-hidden>
              {t("scale", { value: Math.round(scale * 100) })}
            </span>
            <button type="button" onClick={zoomIn} aria-label={t("zoomIn")}>
              <ZoomIn aria-hidden className="size-4" />
            </button>
            <button type="button" onClick={reset} aria-label={t("reset")}>
              <RotateCcw aria-hidden className="size-4" />
            </button>
          </div>
          <DialogPrimitive.Close aria-label={t("close")} className="jb-mermaid-zoom__close">
            <X aria-hidden className="size-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
