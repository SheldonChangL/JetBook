"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useTranslations } from "next-intl";
import { RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";

/**
 * 閱讀端 Mermaid 圖表放大檢視（#247）。
 * 點擊內嵌圖表 → 開啟 lightbox Modal（Radix Dialog：focus trap／Esc／鎖捲動）。
 *
 * 縮放採「改變 SVG 佈局尺寸」而非 CSS `transform: scale()`：後者放大的是已光柵化的圖層
 * （點陣），SVG 會變模糊；改 SVG 版面寬度則讓瀏覽器以向量重繪，任意倍率皆銳利。
 * 平移才用 `translate`（不影響清晰度）。開啟時自動 fit 到視窗，讓小圖也看得清。零新增相依。
 *
 * SVG 由 MermaidDiagram 於 client 端渲染完成後以字串傳入；同源、已由 mermaid 產生。
 */

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const STEP = 1.25;

const clampScale = (value: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

/** 由 SVG 字串解析內在尺寸（viewBox 優先，退回 max-width，再退回預設）。純讀取、不改字串。 */
function parseSvgSize(svg: string): { w: number; h: number } {
  const vb = /viewBox="([^"]+)"/i.exec(svg);
  if (vb) {
    const parts = vb[1]!.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) {
      return { w: parts[2]!, h: parts[3]! };
    }
  }
  const mw = /max-width:\s*([\d.]+)px/i.exec(svg);
  const w = mw ? Number(mw[1]) : 800;
  return { w: w > 0 ? w : 800, h: 0 };
}

export function MermaidZoom({ svg, label }: { svg: string; label: string }) {
  const t = useTranslations("reading.mermaid");
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const base = useMemo(() => parseSvgSize(svg), [svg]);

  /** 依當前視窗算出「fit 到視窗」的縮放倍率（寬與高皆納入）。 */
  const computeFit = useCallback((): number => {
    const vp = viewportRef.current;
    if (!vp || base.w <= 0) return 1;
    let s = (vp.clientWidth * 0.92) / base.w;
    if (base.h > 0) s = Math.min(s, (vp.clientHeight * 0.9) / base.h);
    return clampScale(s);
  }, [base]);

  const fitToView = useCallback(() => {
    setScale(computeFit());
    setTx(0);
    setTy(0);
  }, [computeFit]);

  // 開啟時（Radix 掛載 portal、viewport 就緒後）自動 fit；useLayoutEffect 避免先閃一下再校正。
  useLayoutEffect(() => {
    if (open) fitToView();
  }, [open, fitToView]);

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
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
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
            ref={viewportRef}
            className="jb-mermaid-zoom__viewport"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div
              className="jb-mermaid-zoom__pan"
              style={{ transform: `translate(${tx}px, ${ty}px)` }}
            >
              {/* 寬度＝內在寬 × 倍率（px）：SVG 以向量重繪於此寬度，放大不糊 */}
              <div
                className="jb-mermaid-zoom__stage"
                style={{ width: `${Math.round(base.w * scale)}px` }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
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
            <button type="button" onClick={fitToView} aria-label={t("reset")}>
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
