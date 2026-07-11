"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const HIGHLIGHT_CLASS = "anchor-target-highlight";
const HIGHLIGHT_MS = 2000;

/**
 * 載入含 hash 的分享連結時（G-05）：平滑捲動到對應標題並短暫高亮 2 秒。
 * 也監聽 hashchange（同頁切換錨點）。尊重 prefers-reduced-motion：關閉平滑捲動。
 * 掛在閱讀頁，內容渲染於同頁 RSC，故 mount 後 DOM 已就緒。
 */
export function AnchorHighlight() {
  const pathname = usePathname();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function apply() {
      const raw = window.location.hash.slice(1);
      if (!raw) return;
      let id = raw;
      try {
        id = decodeURIComponent(raw);
      } catch {
        // 保留原始字串
      }
      const el = document.getElementById(id);
      if (!el) return;

      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });

      el.classList.add(HIGHLIGHT_CLASS);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
    }

    // 等內容 paint 後再捲動（headings 於同頁 RSC，rAF 已足夠）
    const raf = requestAnimationFrame(apply);
    window.addEventListener("hashchange", apply);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", apply);
      if (timer) clearTimeout(timer);
    };
  }, [pathname]);

  return null;
}
