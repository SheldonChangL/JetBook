"use client";

import { ExternalLink, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  EMBED_IFRAME_ALLOW,
  EMBED_IFRAME_SANDBOX,
  parseHttpUrl,
} from "@/lib/content/embed";

/**
 * Embed 內容呈現（D-14，F-EDIT-15）。編輯器節點視圖與閱讀渲染共用同一元件，確保「編輯與閱讀一致」。
 *
 * 呈現決策由呼叫端傳入的 `allowed`（依白名單於渲染當下推導）決定：
 * - allowed 且 URL 合法（http/https）：以 sandbox iframe 嵌入（16:9 響應式容器）。
 * - 否則（名單外／不支援）：退化為可點擊的連結卡片（F-EDIT-15 第二條驗收）。
 * - URL 非 http(s)（javascript:/data: 等）：不輸出可點擊連結，只顯示純文字，杜絕 scheme 注入。
 */
export function ContentEmbed({ url, allowed }: { url: string; allowed: boolean }) {
  const t = useTranslations("content.embed");
  const parsed = parseHttpUrl(url);

  // URL 無法解析或非 http(s)（javascript:/data: 等）：安全退化為通用提示，
  // 不回顯原始 URL 字串（縱深防禦，避免把惡意 scheme 文字輸出到頁面）。
  if (!parsed) {
    return (
      <div className="jb-embed jb-embed--invalid" data-embed="">
        <Link2 aria-hidden className="jb-embed__card-icon" />
        <span className="jb-embed__card-text">{t("invalid")}</span>
      </div>
    );
  }

  if (allowed) {
    return (
      <div className="jb-embed jb-embed--frame" data-embed="">
        <div className="jb-embed__frame-box">
          <iframe
            className="jb-embed__iframe"
            src={parsed.href}
            title={t("frameTitle", { host: parsed.hostname })}
            sandbox={EMBED_IFRAME_SANDBOX}
            allow={EMBED_IFRAME_ALLOW}
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
    );
  }

  // 名單外：連結卡片。
  return (
    <a
      href={parsed.href}
      target="_blank"
      rel="noreferrer noopener"
      className="jb-embed jb-embed--card"
      data-embed=""
    >
      <Link2 aria-hidden className="jb-embed__card-icon" />
      <span className="jb-embed__card-body">
        <span className="jb-embed__card-host">{parsed.hostname}</span>
        <span className="jb-embed__card-url">{parsed.href}</span>
      </span>
      <ExternalLink aria-hidden className="jb-embed__card-open" />
    </a>
  );
}
