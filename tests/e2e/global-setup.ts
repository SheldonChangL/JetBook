import { E2E_ADMIN, E2E_MEMBER, E2E_RESET_ADMIN, E2E_RESET_TARGET } from "./accounts";
import { seedAccounts } from "./seed";

/**
 * E2E 全域設定（N-02、#275）：整批執行前 upsert 全部測試帳號。
 * 雜湊與 upsert 細節見 `./seed.ts`（同一支 helper 供會改密碼的 spec 逐條重置使用）。
 */
export default async function globalSetup(): Promise<void> {
  await seedAccounts([
    { account: E2E_ADMIN, orgRole: "admin" },
    { account: E2E_MEMBER, orgRole: "member" },
    { account: E2E_RESET_ADMIN, orgRole: "admin" },
    { account: E2E_RESET_TARGET, orgRole: "member" },
  ]);
}
