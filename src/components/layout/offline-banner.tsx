"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";

/**
 * 全域離線 banner（G-04，設計規範 §3.12）：navigator.onLine ＋ online/offline 事件。
 * C7：不承諾本機持久化；編輯內容保留於編輯器記憶體並自動重試 autosave。
 */
export function OfflineBanner() {
  const t = useTranslations("shell");
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="offline-banner flex shrink-0 items-center justify-center gap-2 border-b border-warning bg-warning-tint px-4 py-1.5 text-caption text-fg"
    >
      <WifiOff aria-hidden className="size-3.5 text-warning" />
      {t("offlineBanner")}
    </div>
  );
}
