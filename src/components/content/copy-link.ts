/**
 * 複製任意文字到剪貼簿。
 * 優先用 Clipboard API，非安全內容（純 HTTP 內網）或舊瀏覽器回退到 execCommand。
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下方後備路徑
  }

  // 後備：純 HTTP 內網（navigator.clipboard 僅安全內容可用）或舊瀏覽器。
  // Safari 對 off-screen / readonly textarea 的 select() 會失效——execCommand 仍回傳 true
  // 卻沒真的寫入剪貼簿。故：不設 readonly、置於視窗內但透明、focus 後以 setSelectionRange
  // 明確建立選取範圍，確保 execCommand("copy") 作用在正確內容上。
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.left = "0";
    el.style.width = "1px";
    el.style.height = "1px";
    el.style.padding = "0";
    el.style.border = "none";
    el.style.opacity = "0";
    // iOS Safari 需可編輯＋非唯讀才允許 setSelectionRange 選取
    el.contentEditable = "true";
    el.readOnly = false;
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 複製當前頁面連結（G-05）。
 * 以瀏覽器目前的 origin + pathname 組出完整 URL，可選帶錨點。
 */
export async function copyPageLink(hashId?: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const { origin, pathname } = window.location;
  return copyText(`${origin}${pathname}${hashId ? `#${encodeURIComponent(hashId)}` : ""}`);
}
