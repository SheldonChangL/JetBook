/**
 * 複製當前頁面連結（G-05）。
 * 以瀏覽器目前的 origin + pathname 組出完整 URL，可選帶錨點；
 * 優先用 Clipboard API，非安全內容或舊瀏覽器回退到 execCommand。
 */
export async function copyPageLink(hashId?: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const { origin, pathname } = window.location;
  const url = `${origin}${pathname}${hashId ? `#${encodeURIComponent(hashId)}` : ""}`;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    // 落到下方後備路徑
  }

  try {
    const el = document.createElement("textarea");
    el.value = url;
    el.setAttribute("readonly", "");
    el.style.position = "absolute";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
