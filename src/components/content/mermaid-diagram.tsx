"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { normalizeMermaidSource } from "@/lib/content/mermaid";
import { renderMermaid } from "@/components/editor/mermaid/render-mermaid";

/**
 * Mermaid 圖表渲染元件（D-13，F-EDIT-14）——編輯端預覽與閱讀端共用。
 * - client-only：mermaid 依賴 DOM，於 useEffect 內動態載入渲染，SSR 期間先顯示載入狀態。
 * - 語法錯誤不崩頁：捕捉 render 例外並改顯示錯誤框（F-EDIT-14 驗收）。
 * - `debounceMs`：編輯端傳入防抖延遲（邊打字邊預覽），閱讀端為靜態內容不需防抖（預設 0）。
 */
export function MermaidDiagram({
  source,
  debounceMs = 0,
}: {
  source: string;
  debounceMs?: number;
}) {
  const t = useTranslations("editor.mermaid");
  const code = normalizeMermaidSource(source).trim();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    if (!code) {
      setSvg(null);
      setError(null);
      setRendering(false);
      return;
    }
    let cancelled = false;
    setRendering(true);
    const run = async () => {
      try {
        const out = await renderMermaid(code);
        if (cancelled) return;
        setSvg(out);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setSvg(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setRendering(false);
      }
    };
    if (debounceMs > 0) {
      const timer = setTimeout(run, debounceMs);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [code, debounceMs]);

  if (!code) return null;

  if (error) {
    return (
      <div className="jb-mermaid__error" role="alert">
        <span className="jb-mermaid__error-title">{t("errorTitle")}</span>
        <pre className="jb-mermaid__error-detail">{error}</pre>
      </div>
    );
  }

  if (svg) {
    return (
      <div
        className="jb-mermaid__preview"
        role="img"
        aria-label={t("diagramLabel")}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  return (
    <div className="jb-mermaid__loading" aria-live="polite">
      {rendering ? t("rendering") : null}
    </div>
  );
}
