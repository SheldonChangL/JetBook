"use client";

import { useEffect } from "react";
import { applyTheme, type Theme } from "@/lib/theme";

/**
 * 登入後以伺服器端偏好（users.theme_preference）校正本機主題（B-08 跨裝置同步）。
 * DB 為權威來源：每次載入以伺服器值覆寫本機快取，使其他裝置的變更在此裝置生效。
 * 掛在 (app) layout，隨 App Shell 只在初次載入/整頁重載時執行一次。
 */
export function ThemeSync({ serverTheme }: { serverTheme: Theme }) {
  useEffect(() => {
    applyTheme(serverTheme);
  }, [serverTheme]);
  return null;
}
