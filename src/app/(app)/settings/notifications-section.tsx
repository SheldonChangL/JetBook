"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { updateEmailNotificationPrefAction } from "@/actions/settings";
import { useToast } from "@/components/ui/toast";

const EMAIL_NOTIFICATION_TYPES = ["comment_reply", "page_mention"] as const;
type EmailNotificationType = (typeof EMAIL_NOTIFICATION_TYPES)[number];

/**
 * Email 通知偏好（M4-05，F-NOTIF-02）：逐類型開關，預設全開。
 * 切換即儲存（樂觀更新，失敗回滾）。
 */
export function NotificationsSection({
  initialPrefs,
}: {
  initialPrefs: Record<string, boolean> | null;
}) {
  const t = useTranslations("settings");
  const toast = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean>>(initialPrefs ?? {});
  const [, startTransition] = useTransition();

  function toggle(type: EmailNotificationType, enabled: boolean) {
    const prev = prefs;
    setPrefs({ ...prefs, [type]: enabled });
    startTransition(async () => {
      try {
        const result = await updateEmailNotificationPrefAction({ type, enabled });
        if (!result.ok) throw new Error(result.error);
      } catch {
        setPrefs(prev);
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <section id="notifications" className="archive-personal-section archive-notification-settings flex flex-col gap-4 rounded-md border border-edge p-5">
      <div>
        <h2 className="text-h3 text-fg">{t("notificationsHeading")}</h2>
        <p className="text-body-ui text-fg-secondary">{t("notificationsDesc")}</p>
      </div>
      <ul className="archive-notification-preferences flex flex-col gap-3">
        {EMAIL_NOTIFICATION_TYPES.map((type) => (
          <li key={type} className="flex items-center justify-between gap-4">
            <span className="text-body-ui text-fg">{t(`emailNotif.${type}`)}</span>
            <label className="flex cursor-pointer items-center gap-2 text-body-ui text-fg-secondary">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={prefs[type] !== false}
                onChange={(e) => toggle(type, e.target.checked)}
              />
              {t("emailNotifEnabled")}
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
