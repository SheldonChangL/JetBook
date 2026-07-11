import { Info, CircleCheck, TriangleAlert, OctagonAlert, type LucideIcon } from "lucide-react";
import type { CalloutKind } from "@/lib/content/callout";

/**
 * Callout 各語意 kind 的圖示（D-06）。編輯端 NodeView 與閱讀端渲染共用，
 * 以 lucide 元件取代 emoji：可隨語意色 token 上色、深淺色一致、可縮放。
 */
export const CALLOUT_ICONS: Record<CalloutKind, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
};
