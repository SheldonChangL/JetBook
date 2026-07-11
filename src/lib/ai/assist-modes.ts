/**
 * 編輯器寫作輔助的模式清單與請求上限（I-08）。
 *
 * 純模組（無執行期相依、非 server-only）：後端 route/lib 與前端 bubble menu
 * 共用同一組 mode 定義與長度上限，確保線協定一致（比照 `types.ts` 的分層原則）。
 */

/** 寫作輔助模式（對應 /api/ai/assist 的 body.mode 與 bubble menu 下拉選項）。 */
export const ASSIST_MODES = ["rewrite", "concise", "formal", "fix", "translate_en"] as const;

export type AssistMode = (typeof ASSIST_MODES)[number];

/** 選取文字長度上限（字元）——輕量任務，避免過長輸入拖累延遲與成本。 */
export const ASSIST_MAX_INPUT_CHARS = 4000;
