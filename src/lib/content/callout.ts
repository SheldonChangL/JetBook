/**
 * Callout 提示區塊的語意 kind 白名單（D-06，F-EDIT-08）。
 * 純資料/守衛，無 UI 相依：extension、NodeView、slash 選單、閱讀渲染共用同一組定義。
 * 圖示對應在 `src/components/content/callout-icons.ts`（UI 層），避免把 lucide 帶進 lib。
 */
export const CALLOUT_KINDS = ["info", "success", "warning", "danger"] as const;

export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** 預設 kind（新插入或非法值回落）。 */
export const DEFAULT_CALLOUT_KIND: CalloutKind = "info";

/** 是否為合法 kind（預設拒絕：白名單外一律 false）。 */
export function isCalloutKind(value: unknown): value is CalloutKind {
  return (
    typeof value === "string" && (CALLOUT_KINDS as readonly string[]).includes(value)
  );
}

/** 正規化任意輸入為合法 kind；非法值回落預設，確保渲染與序列化不炸。 */
export function normalizeCalloutKind(value: unknown): CalloutKind {
  return isCalloutKind(value) ? value : DEFAULT_CALLOUT_KIND;
}
