/**
 * Mermaid 圖表節點的共用資料/守衛（D-13，F-EDIT-14）。
 * 純資料，無 UI 與 mermaid 函式庫相依：extension、NodeView、閱讀渲染、序列化共用。
 * mermaid 圖表原始碼（source）為節點屬性字串（canonical）；實際渲染只在 client 端進行。
 */

/** 節點名稱（extension、序列化、渲染共用單一字面）。 */
export const MERMAID_NODE_NAME = "mermaid";

/** 新插入時的預設範例（一段最小可渲染的流程圖，讓使用者有起點可改）。 */
export const DEFAULT_MERMAID_SOURCE = `graph TD\n  A[開始] --> B[結束]`;

/** 將任意輸入正規化為字串原始碼；非字串回落空字串，確保渲染與序列化不炸。 */
export function normalizeMermaidSource(value: unknown): string {
  return typeof value === "string" ? value : "";
}
