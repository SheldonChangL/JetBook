"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Monitor, Moon, Sun } from "lucide-react";
import { updateAppearanceAction } from "@/actions/settings";
import { applyTheme, readStoredTheme, type Theme } from "@/lib/theme";
import { IconButton } from "@/components/ui/icon-button";

/**
 * 深色模式切換（淺/深/跟隨系統）；與 layout head 的防 FOUC script 一致。
 * 變更同時套用至本機並持久化至 DB（users.theme_preference），與個人設定頁跨裝置同步。
 */
export function ThemeToggle() {
  const t = useTranslations("shell");
  const [theme, setTheme] = useState<Theme>("system");
  const [, startTransition] = useTransition();

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    applyTheme(next);
    startTransition(async () => {
      await updateAppearanceAction({ theme: next });
    });
  }

  const next: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
  const icon =
    theme === "light" ? (
      <Sun className="size-4" />
    ) : theme === "dark" ? (
      <Moon className="size-4" />
    ) : (
      <Monitor className="size-4" />
    );

  return (
    <IconButton label={t("toggleTheme")} onClick={() => apply(next[theme])}>
      {icon}
    </IconButton>
  );
}
