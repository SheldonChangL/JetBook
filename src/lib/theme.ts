/**
 * 外觀主題客戶端工具（B-08 / G-01）。純瀏覽器端：只在 client 元件呼叫。
 * localStorage 作為避免 FOUC 的快取；DB users.theme_preference 為跨裝置的權威來源
 * （登入後由 ThemeSync 以伺服器值校正）。與 layout head 的防 FOUC script 一致。
 */
export const THEME_STORAGE_KEY = "jetbook-theme";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** 依偏好與系統設定判定是否套用深色。 */
export function resolveIsDark(theme: Theme): boolean {
  return (
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

/** 套用主題至 document 與 localStorage；system 移除本地鍵以回落系統判定。 */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", resolveIsDark(theme));
  if (theme === "system") localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/** 讀取本機已存主題；未設定或非法值一律視為 system。 */
export function readStoredTheme(): Theme {
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}
