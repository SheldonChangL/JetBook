// 建立（或重設）第一個組織管理員（org admin）——全新安裝的引導步驟。
//
// 為何需要：本地帳號的 createUser 需既有 org admin 才能呼叫（權限在 action 薄殼斷言），
// 且 v1 無公開註冊路由；OIDC JIT 佈建的使用者預設為 member。因此全新資料庫需要一個
// 帶外（out-of-band）引導入口來產生第一個 admin，之後所有帳號改由 /admin/users 建立。
//
// 只用既有相依（pg + @node-rs/argon2），不經 src/lib（server-only）、不需 build。
// 連線字串取自 DATABASE_URL（同 drizzle-kit）。
//
// 用法：
//   JETBOOK_ADMIN_EMAIL=admin@jet-opto.com.tw JETBOOK_ADMIN_PASSWORD='至少10碼' \
//   JETBOOK_ADMIN_NAME='系統管理員' npm run db:seed-admin
// 或：
//   node scripts/seed-admin.mjs --email admin@jet-opto.com.tw --password '至少10碼' --name '系統管理員'
//
// 冪等：email 已存在時，將其升為 admin、啟用、並重設密碼（可用於救回被鎖死的後台）。

import { hash } from "@node-rs/argon2";
import pg from "pg";

// 純 node 腳本不像 Next.js 會自動載入 .env（同 drizzle.config.ts）。
// CI／正式環境以環境變數直接注入，缺 .env 不視為錯誤。
try {
  process.loadEnvFile(".env");
} catch {
  // .env 不存在時走既有環境變數
}

// Argon2id 參數必須與 src/lib/auth/password.ts 的 ARGON2_OPTIONS 一致，
// 否則登入時 verify 會失敗（@node-rs/argon2 的 verify 會讀 hash 內嵌參數，
// 但顯式帶入的 options 需相容）。
const ARGON2_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 1 };

// 與 src/lib/auth/password.ts 的 MIN_PASSWORD_LENGTH 一致。
const MIN_PASSWORD_LENGTH = 10;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--email") out.email = argv[(i += 1)];
    else if (arg === "--password") out.password = argv[(i += 1)];
    else if (arg === "--name") out.name = argv[(i += 1)];
  }
  return out;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const email = (args.email ?? process.env.JETBOOK_ADMIN_EMAIL ?? "").trim();
const password = args.password ?? process.env.JETBOOK_ADMIN_PASSWORD ?? "";
const name = (args.name ?? process.env.JETBOOK_ADMIN_NAME ?? "系統管理員").trim();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("缺少 DATABASE_URL（設環境變數或於 .env 提供）。");
if (!email || !email.includes("@")) fail("需提供有效 email（--email 或 JETBOOK_ADMIN_EMAIL）。");
if (password.length < MIN_PASSWORD_LENGTH) {
  fail(`密碼至少 ${MIN_PASSWORD_LENGTH} 碼（--password 或 JETBOOK_ADMIN_PASSWORD）。`);
}

const passwordHash = await hash(password, ARGON2_OPTIONS);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const result = await client.query(
    `INSERT INTO users (email, name, password_hash, org_role, auth_provider, is_active)
     VALUES ($1, $2, $3, 'admin', 'local', true)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           org_role = 'admin',
           auth_provider = 'local',
           is_active = true,
           updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [email, name, passwordHash],
  );
  const row = result.rows[0];
  console.log(`✓ ${row.inserted ? "已建立" : "已更新為"} org admin：${email}（id=${row.id}）`);
  console.log("  下一步：以此帳號登入 → /admin/users 建立其餘使用者、/app 建立第一個 Space。");
} finally {
  await client.end();
}
