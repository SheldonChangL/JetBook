"use client";

import { useTranslations } from "next-intl";
import { Copy } from "lucide-react";
import { copyText } from "@/components/content/copy-link";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { buildMcpSnippets } from "@/lib/mcp/setup-snippets";

/**
 * MCP 接入設定片段（唯一產生器）：把端點與 token 直接組成可複製的客戶端設定，
 * 使用者不必自行拼字串。設定頁建立 token 後（明文僅此一次）與使用說明頁共用；
 * 未帶 token 時以佔位字樣呈現格式。
 *
 * Claude Desktop 的設定分 macOS 與 Windows 兩份：Windows 上 `"command": "npx"` 會被包成
 * 未加引號的 `cmd.exe /c <絕對路徑>`，node 裝在含空白的路徑（`C:\Program Files\nodejs`）即啟動失敗。
 */
export function McpSetup({ baseUrl, token }: { baseUrl: string; token?: string }) {
  const t = useTranslations("mcpSetup");
  const toast = useToast();

  const { endpoint, insecure, codeCommand, desktopMac, desktopWindows } = buildMcpSnippets(
    baseUrl,
    token,
  );

  async function onCopy(text: string) {
    const ok = await copyText(text);
    toast(
      ok
        ? { variant: "success", title: t("copied") }
        : { variant: "error", title: t("copyFailed") },
    );
  }

  return (
    <div className="archive-mcp-setup flex flex-col gap-4">
      <p className="text-caption text-fg-tertiary">
        {t("endpointLabel")}
        <code className="ml-2 font-mono text-fg-secondary">{endpoint}</code>
      </p>

      <Snippet
        title={t("clientCodeTitle")}
        content={codeCommand}
        hint={t("codeHint")}
        copyLabel={t("copy")}
        selectHint={t("clickToSelect")}
        onCopy={onCopy}
      />

      <Snippet
        title={t("clientDesktopMacTitle")}
        content={desktopMac}
        hint={t("desktopMacHint")}
        copyLabel={t("copy")}
        selectHint={t("clickToSelect")}
        onCopy={onCopy}
      />

      <Snippet
        title={t("clientDesktopWindowsTitle")}
        content={desktopWindows}
        hint={t("desktopWindowsHint")}
        copyLabel={t("copy")}
        selectHint={t("clickToSelect")}
        onCopy={onCopy}
      />

      <p className="text-caption text-fg-tertiary">{t("linuxNote")}</p>

      {!token && <p className="text-caption text-fg-tertiary">{t("placeholderNote")}</p>}

      {!insecure && <p className="text-caption text-fg-tertiary">{t("connectorNote")}</p>}

      {insecure && (
        <p className="rounded-md bg-warning-tint px-3 py-2 text-caption text-warning">
          {t("httpNote")}
        </p>
      )}
    </div>
  );
}

function Snippet({
  title,
  content,
  hint,
  copyLabel,
  selectHint,
  onCopy,
}: {
  title: string;
  content: string;
  hint?: string;
  copyLabel: string;
  selectHint: string;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="archive-mcp-snippet flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-body-ui font-medium text-fg">{title}</p>
        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => onCopy(content)}>
          <Copy aria-hidden className="size-4" />
          {copyLabel}
        </Button>
      </div>
      <pre
        title={selectHint}
        // 純 HTTP 內網 clipboard API 可能失效的保底：點一下整段選取，可手動複製
        onClick={(e) => {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(e.currentTarget);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }}
        className="cursor-pointer overflow-x-auto rounded-md bg-sidebar px-3 py-2 font-mono text-caption leading-relaxed text-fg"
      >
        <code>{content}</code>
      </pre>
      {hint && <p className="text-caption text-fg-tertiary">{hint}</p>}
    </div>
  );
}
