/**
 * E2E 冒煙測試專用帳號（N-02）。
 * 由 global-setup 以真 Argon2id 雜湊 upsert 進 DB，測試以帳密走真實登入流程。
 * 與正式／整合測試資料隔離：固定信箱、每次執行覆寫密碼，FK 安全（不刪帳號）。
 */
export interface E2EAccount {
  email: string;
  password: string;
  name: string;
}

/** 組織管理員：建立私有 Space／頁面、編輯、搜尋。 */
export const E2E_ADMIN: E2EAccount = {
  email: "e2e-admin@jetbook.test",
  password: "E2E-Admin-Passw0rd",
  name: "E2E 冒煙管理員",
};

/** 一般成員（org member）：驗證私有 Space 隔離（不可見／404／搜尋不到）。 */
export const E2E_MEMBER: E2EAccount = {
  email: "e2e-member@jetbook.test",
  password: "E2E-Member-Passw0rd",
  name: "E2E 冒煙成員",
};

/**
 * 專用 org admin（#275）：只給「admin 重設自己密碼」測試使用。
 * 該測試會把這個帳號的密碼換成一次性隨機密碼，沿用 E2E_ADMIN 會讓同批其他 spec
 * 登入失敗，故必須是獨立帳號。
 */
export const E2E_RESET_ADMIN: E2EAccount = {
  email: "e2e-reset-admin@jetbook.test",
  password: "E2E-Reset-Admin-Passw0rd",
  name: "E2E 重設密碼管理員",
};

/**
 * 專用一般成員（#275）：被 admin 重設密碼的對象。
 * 密碼與既有 session 都會被打斷，故不共用 E2E_MEMBER（冒煙旅程仍需其登入）。
 */
export const E2E_RESET_TARGET: E2EAccount = {
  email: "e2e-reset-target@jetbook.test",
  password: "E2E-Reset-Target-Passw0rd",
  name: "E2E 重設密碼對象",
};
