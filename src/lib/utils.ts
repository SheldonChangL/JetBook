import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合併 className：clsx 條件組合 + tailwind-merge 去衝突。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
