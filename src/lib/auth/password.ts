import "server-only";
import { hash, verify } from "@node-rs/argon2";

/**
 * 密碼雜湊：Argon2id（NFR-SEC-02：memory ≥ 64MB、iterations ≥ 3）。
 * OWASP 首選；不用 bcrypt（72-byte 截斷、GPU 抗性較弱）。
 */
const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export const MIN_PASSWORD_LENGTH = 10;

/** 常見弱密碼封鎖清單（最小集合；完整政策見 B-02 登入流程）。 */
const WEAK_PASSWORDS = new Set([
  "password1234",
  "1234567890",
  "qwertyuiop",
  "jetbook123",
  "jetopto123",
]);

export function isPasswordAcceptable(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH && !WEAK_PASSWORDS.has(password.toLowerCase());
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    // 格式不合法的 hash 一律視為驗證失敗
    return false;
  }
}
