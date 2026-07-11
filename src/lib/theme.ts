/**
 * 外觀主題工具（B-08 / G-01 / G-03）。
 * - `normalizeTheme` 為純函式（不觸及瀏覽器 API），伺服器端 layout 亦可呼叫，
 *   用來把 DB 的 users.theme_preference 正規化成 Theme 以決定 SSR 掛載的 html class。
 * - 其餘（applyTheme / readStoredTheme / resolveIsDark）為純瀏覽器端：只在 client 元件呼叫。
 * localStorage 作為本機覆蓋與避免 FOUC 的快取；DB users.theme_preference 為跨裝置預設來源
 * （首次載入由 SSR 直接掛 html class，防 FOUC script 精度：localStorage 覆蓋 > SSR class > 系統）。
 */
export const THEME_STORAGE_KEY = "jetbook-theme";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * 把 DB 儲存的偏好（"light" / "dark" / null / 任意舊值）正規化成合法 Theme；
 * 非 light/dark 一律視為 system（含 NULL 未設定）。伺服器與客戶端共用。
 */
export function normalizeTheme(value: string | null | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

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
