import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { importUsers, markExistingEmails, parseUsersCsv } from "@/lib/admin/user-import";
import { seedUser } from "./helpers";

/** M4-02 CSV 批次建立整合測試（真 PG）：單交易批次建立、既有 email 略過、密碼可登入。 */

function csvRowsFor(emails: string[]): string {
  return ["email,name,org_role", ...emails.map((e, i) => `${e},匯入使用者${i},member`)].join("\n");
}

describe("importUsers 批次建立（M4-02，issue #193）", () => {
  it("N 列合法資料一次建立 N 個帳號，初始密碼可通過驗證", async () => {
    const marker = randomUUID().slice(0, 8);
    const emails = [`imp-${marker}-a@test.jetbook`, `imp-${marker}-b@test.jetbook`];
    const parsed = parseUsersCsv(csvRowsFor(emails));
    if (!parsed.ok) throw new Error(parsed.error);

    const results = await importUsers(parsed.rows);
    expect(results.every((r) => r.status === "created")).toBe(true);
    expect(results.map((r) => r.email).sort()).toEqual([...emails].sort());

    for (const r of results) {
      const row = await db.query.users.findFirst({ where: eq(users.email, r.email) });
      expect(row).toBeDefined();
      expect(row?.authProvider).toBe("local");
      expect(row?.isActive).toBe(true);
      // 初始密碼真的能用（Argon2id 驗證）
      expect(r.password).toBeTruthy();
      expect(await verifyPassword(row!.passwordHash!, r.password!)).toBe(true);
    }
  });

  it("DB 已存在的 email 標 EMAIL_TAKEN 且不建立，其他列不受影響", async () => {
    const existing = await seedUser();
    const marker = randomUUID().slice(0, 8);
    const fresh = `imp-${marker}-new@test.jetbook`;
    const parsed = parseUsersCsv(csvRowsFor([existing.email, fresh]));
    if (!parsed.ok) throw new Error(parsed.error);

    const results = await importUsers(parsed.rows);
    const taken = results.find((r) => r.email === existing.email);
    const created = results.find((r) => r.email === fresh);
    expect(taken).toMatchObject({ status: "skipped", reason: "EMAIL_TAKEN" });
    expect(taken?.password).toBeUndefined();
    expect(created).toMatchObject({ status: "created" });

    // 既有帳號未被覆寫
    const row = await db.query.users.findFirst({ where: eq(users.email, existing.email) });
    expect(row?.id).toBe(existing.id);
  });

  it("markExistingEmails 供預覽：標示 DB 既有 email、不改動資料", async () => {
    const existing = await seedUser();
    const marker = randomUUID().slice(0, 8);
    const parsed = parseUsersCsv(csvRowsFor([existing.email, `imp-${marker}-x@test.jetbook`]));
    if (!parsed.ok) throw new Error(parsed.error);

    const marked = await markExistingEmails(parsed.rows);
    expect(marked.find((r) => r.email === existing.email)?.error).toBe("EMAIL_TAKEN");
    expect(marked.find((r) => r.email !== existing.email)?.error).toBeUndefined();
  });

  it("解析錯誤列（格式錯誤/檔內重複）僅略過該列", async () => {
    const marker = randomUUID().slice(0, 8);
    const good = `imp-${marker}-ok@test.jetbook`;
    const csv = `email,name\nnot-an-email,壞\n${good},好\n${good},重複`;
    const parsed = parseUsersCsv(csv);
    if (!parsed.ok) throw new Error(parsed.error);

    const results = await importUsers(parsed.rows);
    expect(results.map((r) => [r.status, r.reason])).toEqual([
      ["skipped", "INVALID_EMAIL"],
      ["created", undefined],
      ["skipped", "DUPLICATE_IN_FILE"],
    ]);
  });
});
