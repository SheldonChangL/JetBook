import { hash } from "@node-rs/argon2";
import { Pool } from "pg";
import { E2E_ADMIN, E2E_MEMBER, type E2EAccount } from "./accounts";

/**
 * E2E 冒煙全域設定（N-02）：以真 Argon2id 雜湊 upsert 測試帳號，
 * 讓冒煙旅程能走真實登入流程而不依賴任何預先存在的種子資料（本機與 CI 一致）。
 *
 * 雜湊參數與 src/lib/auth/password.ts 完全一致（Argon2id 為 @node-rs/argon2 預設），
 * 產出的 hash 可被 verifyPassword 接受。以 upsert（on conflict）覆寫密碼、不刪帳號，
 * 避免觸及 sessions／space_members 等外鍵關聯。
 */
const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

function resolveDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // .env 不存在時走既有環境變數（CI 直接注入 DATABASE_URL）
    }
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL 未設定（E2E 種子需連線 PG，見 .env.example）");
  }
  return url;
}

async function upsertAccount(
  pool: Pool,
  account: E2EAccount,
  orgRole: "admin" | "member",
): Promise<void> {
  const passwordHash = await hash(account.password, ARGON2_OPTIONS);
  await pool.query(
    `INSERT INTO users (email, name, password_hash, org_role, auth_provider, is_active)
     VALUES ($1, $2, $3, $4, 'local', true)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           org_role = EXCLUDED.org_role,
           auth_provider = 'local',
           is_active = true,
           updated_at = now()`,
    [account.email, account.name, passwordHash, orgRole],
  );
}

export default async function globalSetup(): Promise<void> {
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  try {
    await upsertAccount(pool, E2E_ADMIN, "admin");
    await upsertAccount(pool, E2E_MEMBER, "member");
  } finally {
    await pool.end();
  }
}
