import type { ProseMirrorNode } from "@/lib/content/types";

/**
 * 標題錨點 slug（G-05）。
 * 由標題純文字產生穩定、URL 安全且可讀的 id；同名標題以 `-1`、`-2`… 去重。
 * 保留中日韓文字（\p{L} 已涵蓋），僅去除空白與符號，讓分享連結錨點在繁中內容下仍可讀。
 */

/** 取標題節點的純文字（忽略 marks，遞迴串接所有 text）。 */
export function headingNodeText(node: ProseMirrorNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(headingNodeText).join("");
}

/** 單一標題文字 → slug base（不含去重後綴）。 */
export function slugifyHeadingText(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-") // 空白 → 連字號
    .replace(/[^\p{L}\p{N}-]+/gu, "") // 去除字母/數字/連字號以外字元（保留 CJK）
    .replace(/-{2,}/g, "-") // 連續連字號收斂
    .replace(/^-+|-+$/g, ""); // 去除頭尾連字號
}

/**
 * 建立去重 slugger：同名 base 追加遞增後綴，空 slug 回退到 fallback。
 * 生成後的 id 也會被記錄，避免與後續同名結果二次碰撞。
 */
export function createHeadingSlugger(fallback = "section") {
  const used = new Set<string>();
  return (text: string): string => {
    const base = slugifyHeadingText(text) || fallback;
    let candidate = base;
    let i = 1;
    while (used.has(candidate)) {
      candidate = `${base}-${i}`;
      i += 1;
    }
    used.add(candidate);
    return candidate;
  };
}
