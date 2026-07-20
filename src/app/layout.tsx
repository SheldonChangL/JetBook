import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Inter, JetBrains_Mono, Noto_Sans_TC } from "next/font/google";
import { getCurrentSession } from "@/lib/auth/current";
import { isPreviewConverterConfigured } from "@/lib/storage/office-preview";
import { normalizeTheme, type Theme } from "@/lib/theme";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansTC = Noto_Sans_TC({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-noto-tc",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbmono",
  display: "swap",
});

// 首屏同步套用主題，避免深色使用者看到白色閃爍（FOUC）。
// 精度（G-03）：localStorage 本機覆蓋 > SSR class（data-server-theme，源自 DB 偏好）> 系統。
// SSR 已依 DB 偏好掛好 dark class；此 script 只在需要時以本機覆蓋或系統判定校正。
const themeInitScript = `(function(){try{var e=document.documentElement,s=localStorage.getItem("jetbook-theme"),d;if(s==="dark"||s==="light"){d=s==="dark"}else{var v=e.getAttribute("data-server-theme");if(v==="dark"||v==="light"){d=v==="dark"}else{d=window.matchMedia("(prefers-color-scheme: dark)").matches}}e.classList.toggle("dark",d)}catch(e){}})()`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("appName"),
    description: t("appDescription"),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations("common");

  // 已登入者：以 DB 偏好決定 SSR 掛載的主題 class，讓首個 HTML 位元組即帶正確主題
  // （跨裝置同步：新裝置無 localStorage 時直接吃 DB 偏好，不閃白）。主題僅為外觀，
  // 讀取失敗一律回退 system，絕不可阻斷頁面渲染。
  let serverTheme: Theme = "system";
  try {
    const session = await getCurrentSession();
    if (session) serverTheme = normalizeTheme(session.user.themePreference);
  } catch {
    serverTheme = "system";
  }

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${notoSansTC.variable} ${jetbrainsMono.variable}${
        serverTheme === "dark" ? " dark" : ""
      }`}
      data-server-theme={serverTheme}
      data-ui-version="archive"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      {/* data-office-preview：Office 附件預覽是否啟用（M4-12，PREVIEW_CONVERTER_URL）。
          以 body dataset 傳遞給深層 client 元件（附件卡片），免 props 穿越 TipTap 渲染鏈 */}
      <body data-office-preview={isPreviewConverterConfigured() ? "1" : undefined}>
        <NextIntlClientProvider>
          <TooltipProvider>
            <ToastProvider closeLabel={t("close")}>{children}</ToastProvider>
          </TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
