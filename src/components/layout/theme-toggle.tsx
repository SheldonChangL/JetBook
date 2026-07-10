"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Monitor, Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";

type Theme = "light" | "dark" | "system";

/** 深色模式切換（淺/深/跟隨系統）；與 layout head 的防 FOUC script 一致。 */
export function ThemeToggle() {
  const t = useTranslations("shell");
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = (localStorage.getItem("jetbook-theme") as Theme | null) ?? "system";
    setTheme(stored);
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    const isDark =
      next === "dark" ||
      (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
    if (next === "system") localStorage.removeItem("jetbook-theme");
    else localStorage.setItem("jetbook-theme", next);
  }

  const next: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
  const icon =
    theme === "light" ? <Sun className="size-4" /> : theme === "dark" ? <Moon className="size-4" /> : <Monitor className="size-4" />;

  return (
    <IconButton label={t("toggleTheme")} onClick={() => apply(next[theme])}>
      {icon}
    </IconButton>
  );
}
