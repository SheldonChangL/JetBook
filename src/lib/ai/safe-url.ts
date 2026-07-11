/**
 * 連結 URL 白名單（I-03）。
 *
 * AI 回答的 Markdown 連結可能夾帶來自文件內容的惡意 URL；渲染成 `<a href>` 前必須
 * 過濾協定以防 XSS。規則：帶協定時僅允許 http/https/mailto；不帶協定（站內相對
 * 連結、錨點）放行；其餘（javascript:、data:、vbscript: …）一律擋下。
 *
 * @returns 安全可用的 URL，或 null（呼叫端應改渲染為純文字）。
 */
export function safeUrl(href: string | undefined | null): string | null {
  const h = (href ?? "").trim();
  if (!h) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(h);
  if (scheme && !/^(https?|mailto)$/i.test(scheme[1] ?? "")) return null;
  return h;
}
