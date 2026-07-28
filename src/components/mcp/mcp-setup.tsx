"use client";

import { useTranslations } from "next-intl";
import { Copy } from "lucide-react";
import { copyText } from "@/components/content/copy-link";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * MCP 接入設定片段（唯一產生器）：把端點與 token 直接組成可複製的客戶端設定，
 * 使用者不必自行拼字串。設定頁建立 token 後（明文僅此一次）與使用說明頁共用；
 * 未帶 token 時以佔位字樣呈現格式。
 */
export function McpSetup({ baseUrl, token }: { baseUrl: string; token?: string }) {
  const t = useTranslations("mcpSetup");
  const toast = useToast();

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/api/mcp`;
  // 未帶 token（使用說明頁）時以明顯的假值呈現格式，避免中文字混進可貼上的指令
  const bearer = token ?? "jbk_xxxxxxxxxxxx";
  // 內網純 HTTP 部署：mcp-remote 預設拒絕非 localhost 的 http://，需 --allow-http
  const insecure = endpoint.startsWith("http://");

  const codeCommand = `claude mcp add --transport http jetbook ${endpoint} \\\n  --header "Authorization: Bearer ${bearer}"`;

  const desktopConfig = JSON.stringify(
    {
      mcpServers: {
        jetbook: {
          command: "npx",
          args: [
            "-y",
            "mcp-remote",
            endpoint,
            ...(insecure ? ["--allow-http"] : []),
            "--header",
            `Authorization: Bearer ${bearer}`,
          ],
        },
      },
    },
    null,
    2,
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
        copyLabel={t("copy")}
        selectHint={t("clickToSelect")}
        onCopy={onCopy}
      />

      <Snippet
        title={t("clientDesktopTitle")}
        content={desktopConfig}
        hint={t("desktopHint")}
        copyLabel={t("copy")}
        selectHint={t("clickToSelect")}
        onCopy={onCopy}
      />

      {!token && <p className="text-caption text-fg-tertiary">{t("placeholderNote")}</p>}

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
