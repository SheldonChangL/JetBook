import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合併 className：clsx 條件組合 + tailwind-merge 去衝突。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * App Router 動態 route param 為 percent-encoded 原文；含 CJK 的 slug
 * （中英混合標題，C-05）必須先還原才能與 DB 內原始字元比對（issue #207）。
 * 非法編碼（如手打 `%zz`）不擲錯，回傳原值交由呼叫端走 404 流程。
 */
export function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
