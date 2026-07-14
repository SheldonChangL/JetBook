"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Copy } from "lucide-react";
import { createApiTokenAction, revokeApiTokenAction } from "@/actions/api-tokens";
import { copyText } from "@/components/content/copy-link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

const EXPIRY_OPTIONS = ["30", "90", "365", "0"] as const;

/** 序列化後的 token 檢視（Date → ISO 字串，跨 server→client 邊界）。 */
export interface ApiTokenRow {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/** API Token 管理（M4-06，F-API-02）：建立（明文一次顯示）、列表、撤銷。 */
export function ApiTokensSection({ tokens }: { tokens: ApiTokenRow[] }) {
  const t = useTranslations("settings.apiTokens");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [expiryDays, setExpiryDays] = useState<(typeof EXPIRY_OPTIONS)[number]>("90");
  const [allowWrite, setAllowWrite] = useState(false);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" });

  function onCreate(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const result = await createApiTokenAction({
          name,
          expiryDays: Number(expiryDays),
          allowWrite,
        });
        if (!result.ok) {
          toast({ variant: "error", title: t("actionError") });
          return;
        }
        setCreated({ token: result.token, name });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  function onRevoke(tokenId: string) {
    startTransition(async () => {
      try {
        const result = await revokeApiTokenAction({ tokenId });
        if (!result.ok) {
          toast({ variant: "error", title: t("actionError") });
          return;
        }
        toast({ variant: "success", title: t("revoked") });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  // token 明文僅顯示這一次（F-API-02），一鍵複製為關鍵路徑（issue #212）
  async function onCopyToken(token: string) {
    const ok = await copyText(token);
    toast(
      ok
        ? { variant: "success", title: t("copied") }
        : { variant: "error", title: t("copyFailed") },
    );
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setCreated(null);
      setExpiryDays("90");
      setAllowWrite(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border border-edge p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-h3 text-fg">{t("heading")}</h2>
          <p className="text-body-ui text-fg-secondary">
            {t("desc")}
            <Link href="/api-docs" className="ml-1 text-primary hover:underline">
              {t("docsLink")}
            </Link>
          </p>
        </div>
        <Modal open={open} onOpenChange={onOpenChange}>
          <ModalTrigger asChild>
            <Button variant="secondary">{t("create")}</Button>
          </ModalTrigger>
          <ModalContent size="sm" title={t("createTitle")} closeLabel={t("close")}>
            {created === null ? (
              <form action={onCreate} className="flex flex-col gap-4">
                <Input name="name" label={t("nameLabel")} required maxLength={100} />
                <div className="flex flex-col gap-1.5">
                  <span className="text-body-ui font-medium text-fg">{t("expiryLabel")}</span>
                  <Select
                    value={expiryDays}
                    onValueChange={(v) => setExpiryDays(v as (typeof EXPIRY_OPTIONS)[number])}
                  >
                    <SelectTrigger aria-label={t("expiryLabel")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {t(`expiry.${d}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="flex cursor-pointer items-center gap-2 text-body-ui text-fg">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={allowWrite}
                      onChange={(e) => setAllowWrite(e.target.checked)}
                    />
                    {t("allowWrite")}
                  </label>
                  <p className="text-caption text-fg-tertiary">{t("allowWriteHint")}</p>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" loading={pending}>
                    {t("create")}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-body-ui text-fg">{t("createdFor", { name: created.name })}</p>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-md bg-sidebar px-3 py-2 font-mono text-body-ui text-fg">
                    {created.token}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    onClick={() => onCopyToken(created.token)}
                  >
                    <Copy aria-hidden className="size-4" />
                    {t("copy")}
                  </Button>
                </div>
                <p className="rounded-md bg-warning-tint px-3 py-2 text-body-ui text-warning">
                  {t("shownOnce")}
                </p>
                <div className="flex justify-end">
                  <Button onClick={() => setOpen(false)}>{t("close")}</Button>
                </div>
              </div>
            )}
          </ModalContent>
        </Modal>
      </div>

      {tokens.length === 0 ? (
        <p className="text-body-ui text-fg-tertiary">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge rounded-md border border-edge">
          {tokens.map((token) => {
            const expired =
              token.expiresAt !== null && new Date(token.expiresAt).getTime() <= Date.now();
            return (
              <li key={token.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-body-ui font-medium text-fg">
                    <span className="truncate">{token.name}</span>
                    {token.scopes.includes("write") && (
                      <Badge variant="warning">{t("writeBadge")}</Badge>
                    )}
                    {expired && <Badge variant="danger">{t("expired")}</Badge>}
                  </p>
                  <p className="text-caption text-fg-tertiary">
                    {t("meta", {
                      created: dateFormat.format(new Date(token.createdAt)),
                      expires: token.expiresAt
                        ? dateFormat.format(new Date(token.expiresAt))
                        : t("never"),
                      lastUsed: token.lastUsedAt
                        ? dateFormat.format(new Date(token.lastUsedAt))
                        : t("neverUsed"),
                    })}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onRevoke(token.id)}>
                  {t("revoke")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
