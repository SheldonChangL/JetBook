"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";

/**
 * 程式碼區塊閱讀端（D-04）：語言標籤 + 複製按鈕 + 行號 + 語法高亮。
 * 高亮節點（children）由 server 端 highlight-to-react 產生後傳入，
 * 原始碼字串（code）僅供複製；client 元件只負責複製互動與行號渲染。
 */
export function CodeBlockReader({
  code,
  languageLabel,
  children,
}: {
  code: string;
  languageLabel: string | null;
  children: ReactNode;
}) {
  const t = useTranslations("editor.codeBlock");
  const [copied, setCopied] = useState(false);

  const lineCount = useMemo(() => Math.max(1, code.split("\n").length), [code]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [code]);

  return (
    <div className="jb-code">
      <div className="jb-code__bar" contentEditable={false}>
        <span className="jb-code__lang">{languageLabel ?? t("plainText")}</span>
        <button
          type="button"
          onClick={onCopy}
          className="jb-code__copy"
          aria-label={t("copyAriaLabel")}
        >
          {copied ? (
            <Check aria-hidden className="size-3.5" />
          ) : (
            <Copy aria-hidden className="size-3.5" />
          )}
          <span>{copied ? t("copied") : t("copy")}</span>
        </button>
      </div>
      <div className="jb-code__body">
        <div className="jb-code__gutter" aria-hidden>
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <pre className="jb-code__pre">
          <code>{children}</code>
        </pre>
      </div>
    </div>
  );
}
