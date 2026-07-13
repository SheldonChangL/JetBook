import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { generateRandomPassword } from "./users";

/**
 * CSV 批次建立使用者（M4-02，issue #193）。
 * 解析為純函式（可單元測試）；建立走單一 INSERT … ON CONFLICT DO NOTHING（單交易、
 * 無 check-then-insert race）。Redmine 側以其 CSV 匯出餵入，故欄名對映涵蓋
 * Redmine 常見匯出欄（First name / Last name 等）。
 */

/** 一次匯入上限：Argon2id 逐列雜湊成本高，過大批次會拖垮 Server Action。 */
export const MAX_IMPORT_ROWS = 200;

export type ImportRowError =
  | "INVALID_EMAIL"
  | "DUPLICATE_IN_FILE"
  | "EMAIL_TAKEN";

export interface ParsedUserRow {
  /** 原始 CSV 列號（含標題列，1-based），供錯誤回報對照 */
  line: number;
  email: string;
  name: string;
  orgRole: User["orgRole"];
  /** 解析階段錯誤（EMAIL_TAKEN 於 DB 比對階段補上） */
  error?: ImportRowError;
}

/** 最小 RFC 4180 解析：引號欄位、雙引號跳脫、CRLF/LF；容忍 UTF-8 BOM。 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  // 去掉尾端完全空白列
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const EMAIL_HEADERS = ["email", "e-mail", "mail", "信箱", "電子郵件"];
const NAME_HEADERS = ["name", "full name", "fullname", "姓名", "使用者", "user"];
const LAST_NAME_HEADERS = ["lastname", "last name", "姓", "姓氏"];
const FIRST_NAME_HEADERS = ["firstname", "first name", "名", "名字"];
const ROLE_HEADERS = ["org_role", "orgrole", "role", "角色", "系統角色"];
const ADMIN_ROLE_VALUES = ["admin", "管理員"];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function findColumn(header: string[], candidates: string[]): number {
  return header.findIndex((h) => candidates.includes(h.trim().toLowerCase()));
}

/** 兩段皆為 CJK 時以「姓＋名」不加空格合併，否則西式「名 姓」。 */
function combineName(firstName: string, lastName: string): string {
  const cjk = /^[一-鿿㐀-䶿]+$/;
  if (firstName && lastName && cjk.test(firstName) && cjk.test(lastName)) {
    return `${lastName}${firstName}`;
  }
  return [firstName, lastName].filter(Boolean).join(" ");
}

export type ParseUsersCsvResult =
  | { ok: true; rows: ParsedUserRow[] }
  | { ok: false; error: "NO_EMAIL_COLUMN" | "EMPTY_FILE" | "TOO_MANY_ROWS" };

/**
 * 解析使用者匯入 CSV（需標題列）。email 不合格式、檔內重複逐列標示；
 * name 缺欄或空值時以 email local part 代替；org_role 僅 admin/管理員 視為管理員。
 */
export function parseUsersCsv(text: string): ParseUsersCsvResult {
  const table = parseCsv(text);
  if (table.length < 2) return { ok: false, error: "EMPTY_FILE" };

  const header = table[0]!;
  const emailCol = findColumn(header, EMAIL_HEADERS);
  if (emailCol === -1) return { ok: false, error: "NO_EMAIL_COLUMN" };
  const nameCol = findColumn(header, NAME_HEADERS);
  const lastNameCol = findColumn(header, LAST_NAME_HEADERS);
  const firstNameCol = findColumn(header, FIRST_NAME_HEADERS);
  const roleCol = findColumn(header, ROLE_HEADERS);

  const dataRows = table.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) return { ok: false, error: "TOO_MANY_ROWS" };

  const seen = new Set<string>();
  const rows: ParsedUserRow[] = dataRows.map((cells, index) => {
    const line = index + 2;
    const email = (cells[emailCol] ?? "").trim().toLowerCase();

    let name = nameCol !== -1 ? (cells[nameCol] ?? "").trim() : "";
    if (!name && (firstNameCol !== -1 || lastNameCol !== -1)) {
      name = combineName(
        firstNameCol !== -1 ? (cells[firstNameCol] ?? "").trim() : "",
        lastNameCol !== -1 ? (cells[lastNameCol] ?? "").trim() : "",
      );
    }
    if (!name) name = email.split("@")[0] ?? "";

    const roleRaw = roleCol !== -1 ? (cells[roleCol] ?? "").trim().toLowerCase() : "";
    const orgRole: User["orgRole"] = ADMIN_ROLE_VALUES.includes(roleRaw) ? "admin" : "member";

    let error: ImportRowError | undefined;
    if (!EMAIL_PATTERN.test(email)) {
      error = "INVALID_EMAIL";
    } else if (seen.has(email)) {
      error = "DUPLICATE_IN_FILE";
    } else {
      seen.add(email);
    }
    return { line, email, name, orgRole, error };
  });

  return { ok: true, rows };
}

/** 對已解析列補上 DB 既有 email 標示（供預覽）。不改動 DB。 */
export async function markExistingEmails(rows: ParsedUserRow[]): Promise<ParsedUserRow[]> {
  const candidates = rows.filter((r) => !r.error).map((r) => r.email);
  if (candidates.length === 0) return rows;
  const existing = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.email, candidates));
  const taken = new Set(existing.map((r) => r.email.toLowerCase()));
  return rows.map((r) => (!r.error && taken.has(r.email) ? { ...r, error: "EMAIL_TAKEN" } : r));
}

export interface ImportedUserResult {
  line: number;
  email: string;
  name: string;
  orgRole: User["orgRole"];
  status: "created" | "skipped";
  reason?: ImportRowError;
  /** 初始密碼——僅建立當下回傳一次，呼叫端顯示後不再保存 */
  password?: string;
  /** 建立成功者的 user id（供寄送歡迎信） */
  userId?: string;
}

/**
 * 批次建立：單一 INSERT … ON CONFLICT (email) DO NOTHING（單交易、無枚舉 race）。
 * 回傳逐列結果；與 DB 撞 email 的列標 EMAIL_TAKEN。
 */
export async function importUsers(rows: ParsedUserRow[]): Promise<ImportedUserResult[]> {
  const valid = rows.filter((r) => !r.error);
  const invalid: ImportedUserResult[] = rows
    .filter((r): r is ParsedUserRow & { error: ImportRowError } => r.error !== undefined)
    .map((r) => ({
      line: r.line,
      email: r.email,
      name: r.name,
      orgRole: r.orgRole,
      status: "skipped",
      reason: r.error,
    }));

  if (valid.length === 0) return invalid.sort((a, b) => a.line - b.line);

  // 逐列產生隨機密碼並雜湊（Argon2id 高成本，故 MAX_IMPORT_ROWS 設上限）
  const prepared = await Promise.all(
    valid.map(async (row) => {
      const password = generateRandomPassword();
      return { row, password, passwordHash: await hashPassword(password) };
    }),
  );

  const inserted = await db
    .insert(users)
    .values(
      prepared.map(({ row, passwordHash }) => ({
        email: row.email,
        name: row.name,
        passwordHash,
        orgRole: row.orgRole,
        authProvider: "local" as const,
      })),
    )
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id, email: users.email });

  const createdByEmail = new Map(inserted.map((u) => [u.email.toLowerCase(), u.id]));

  const results: ImportedUserResult[] = prepared.map(({ row, password }) => {
    const userId = createdByEmail.get(row.email);
    if (!userId) {
      return {
        line: row.line,
        email: row.email,
        name: row.name,
        orgRole: row.orgRole,
        status: "skipped",
        reason: "EMAIL_TAKEN",
      };
    }
    return {
      line: row.line,
      email: row.email,
      name: row.name,
      orgRole: row.orgRole,
      status: "created",
      password,
      userId,
    };
  });

  return [...results, ...invalid].sort((a, b) => a.line - b.line);
}
