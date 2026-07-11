/**
 * Embed 嵌入節點的共用資料/守衛（D-14，F-EDIT-15）。
 * 純資料，無 UI 與伺服器相依：extension、NodeView、閱讀渲染、序列化、env 解析共用。
 * canonical 只存 URL 字串；「iframe 嵌入 vs 連結卡片」的判斷一律在渲染當下依白名單重新推導，
 * 不把「是否可嵌入」這種會隨白名單變動的狀態寫進文件（安全：白名單縮小後舊 URL 立即退化為卡片）。
 */

/** 節點名稱（extension、序列化、渲染共用單一字面）。 */
export const EMBED_NODE_NAME = "embed";

/**
 * iframe sandbox 屬性（F-EDIT-15 sanitize）。
 * 白名單網域雖由管理者信任，仍以 sandbox 做縱深防禦：
 * - allow-scripts / allow-same-origin：YouTube、Figma 等嵌入需在其「自身」origin 執行腳本與存取自身資源；
 *   因 src 為第三方 origin，此處的 same-origin 指嵌入方自身，不授予存取 JetBook 頁面的權限。
 * - allow-popups / allow-popups-to-escape-sandbox：允許「在 YouTube 開啟」等彈窗跳出沙盒限制。
 * - allow-presentation：全螢幕播放。allow-forms：Figma/表單類互動。
 * 刻意不含 allow-top-navigation（禁止嵌入內容劫持外層導頁）與 allow-modals / allow-downloads。
 */
export const EMBED_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms";

/** iframe 權限政策（Permissions Policy）：允許全螢幕與畫中畫，供影片嵌入使用。 */
export const EMBED_IFRAME_ALLOW = "fullscreen; picture-in-picture; encrypted-media";

/** 將任意輸入正規化為去頭尾空白的 URL 字串；非字串回落空字串。 */
export function normalizeEmbedUrl(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 解析逗號分隔的網域白名單字串 → 正規化網域陣列。
 * 每項：去空白、轉小寫、去 scheme（http(s)://）、去路徑（/…）、去前綴 www.、濾空。
 * 供 `lib/env.ts` 轉換 `EMBED_ALLOWED_DOMAINS`，客戶端經 props 取得同一份陣列。
 */
export function parseEmbedDomains(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) =>
      entry
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/^www\./, ""),
    )
    .filter((domain) => domain.length > 0);
}

/**
 * 解析為安全的 http/https URL；非法或非 http(s) scheme（javascript:、data: 等）一律回 null。
 * iframe src 與連結卡片 href 都必須先過此關，杜絕 scheme 注入。
 */
export function parseHttpUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

/**
 * URL 網域是否落在白名單內。
 * hostname 去 www. 後：完全等於某白名單網域，或為其子網域（以 `.<domain>` 結尾）。
 * 以 dot-suffix 比對避免 `evil-youtube.com`、`youtube.com.evil.com` 誤中 `youtube.com`。
 */
export function isEmbedUrlAllowed(value: string, allowedDomains: readonly string[]): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
