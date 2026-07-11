"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Monitor, Moon, Sun } from "lucide-react";
import { updateAppearanceAction } from "@/actions/settings";
import { applyTheme, THEMES, type Theme } from "@/lib/theme";
import { useToast } from "@/components/ui/toast";

const OPTIONS: { value: Theme; labelKey: string; icon: typeof Sun }[] = [
  { value: "light", labelKey: "themeLight", icon: Sun },
  { value: "dark", labelKey: "themeDark", icon: Moon },
  { value: "system", labelKey: "themeSystem", icon: Monitor },
];

/**
 * ③ 外觀偏好（驗收 2）：淺色／深色／跟隨系統。變更立即套用至本機（class + localStorage）
 * 並持久化至 users.theme_preference；其他裝置首次載入時由 root layout 依此值 SSR 掛主題
 * class，達成跨裝置同步（G-03）。
 */
export function AppearanceSection({ initialTheme }: { initialTheme: Theme }) {
  const t = useTranslations("settings");
  const toast = useToast();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [pending, startTransition] = useTransition();

  function select(next: Theme) {
    if (next === theme || !THEMES.includes(next)) return;
    const previous = theme;
    setTheme(next);
    applyTheme(next);
    startTransition(async () => {
      const result = await updateAppearanceAction({ theme: next });
      if (result.ok) {
        toast({ variant: "success", title: t("appearanceUpdated") });
      } else {
        setTheme(previous);
        applyTheme(previous);
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <section aria-labelledby="appearance-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="appearance-heading" className="text-h4 text-fg">
          {t("appearanceHeading")}
        </h2>
        <p className="text-body-ui text-fg-secondary">{t("appearanceDesc")}</p>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border border-edge bg-raised p-4">
        <legend className="sr-only">{t("appearanceHeading")}</legend>
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 transition-colors hover:bg-hover"
            >
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={theme === option.value}
                disabled={pending}
                onChange={() => select(option.value)}
                className="size-4 accent-primary"
              />
              <Icon aria-hidden className="size-4 text-fg-secondary" />
              <span className="text-body-ui text-fg">{t(option.labelKey)}</span>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}
