/**
 * Mermaid 渲染工具（D-13，F-EDIT-14）——編輯端 NodeView 與閱讀端元件共用。
 *
 * - mermaid 僅在 client 端渲染（依賴 DOM），以動態 import 延遲載入，不進主 bundle、不在 SSR 執行。
 * - `securityLevel: "strict"`：標籤 HTML 一律 sanitize、停用 click/script，避免圖表標籤夾帶 XSS。
 * - 主題跟隨 App 深淺色（`html.dark`）；每次渲染前重新 initialize 以反映當前主題。
 * - 語法錯誤時 `mermaid.render` 會 throw；呼叫端以 try/catch 顯示錯誤框而非崩頁。
 */

type MermaidApi = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidApi> | null = null;
let idCounter = 0;

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => mod.default);
  }
  return mermaidPromise;
}

function resolveTheme(): "dark" | "default" {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
    return "dark";
  }
  return "default";
}

/**
 * 將 mermaid 原始碼渲染為 SVG 字串。成功回傳 svg；語法錯誤則 reject（呼叫端顯示錯誤框）。
 * 失敗時 mermaid 可能殘留暫時 DOM 節點，於 finally 清除避免累積。
 */
export async function renderMermaid(source: string): Promise<string> {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: resolveTheme(),
    fontFamily: "inherit",
  });
  idCounter += 1;
  const id = `jb-mermaid-${idCounter}`;
  try {
    const { svg } = await mermaid.render(id, source);
    return svg;
  } finally {
    if (typeof document !== "undefined") {
      // mermaid 於渲染（尤其失敗）時可能留下暫時量測節點（id 前綴 d）。
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  }
}
