import "server-only";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/lib/db/schema";

/**
 * 稽核日誌檢視商業邏輯（L-04，F-ADMIN-05）。
 *
 * 稽核寫入唯一路徑在 `lib/audit.writeAudit`（append-only）；本模組為唯讀檢視層：
 * 多條件過濾（時間範圍／action 多選／actor 搜尋）＋ (created_at, id) 游標分頁 ＋ CSV 串流匯出。
 *
 * 權限：後台專屬，org admin only。斷言在薄殼層（page / route handler 以 isOrgAdmin 把關），
 * 此層只負責資料規則（與 lib/admin/users 一致，不散寫權限判斷）。
 */

/** 單頁列數上限（後台表格）。 */
export const AUDIT_PAGE_SIZE = 50;
/** CSV 匯出列數上限（F-ADMIN-05：上限 10k 列）。 */
export const MAX_CSV_ROWS = 10_000;
/** CSV 串流每批查詢列數（分批以游標往前推，避免一次載入全部到記憶體）。 */
const CSV_BATCH_SIZE = 1_000;

/** (created_at, id) 複合游標——時間相同時以 id 決序，確保穩定分頁。 */
export interface AuditCursor {
  createdAt: Date;
  id: number;
}

export interface AuditFilter {
  /** action 多選；空陣列／未給＝不過濾。 */
  actions?: string[];
  /** actor 名稱或 email 子字串（大小寫不敏感）。 */
  actorQuery?: string;
  /** 時間範圍下界（含）。 */
  from?: Date;
  /** 時間範圍上界（含）。 */
  to?: Date;
}

export interface AuditLogRow {
  id: number;
  createdAt: Date;
  actorId: string | null;
  /** actor 顯示名；匿名事件或帳號已刪為 null。 */
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  ip: string | null;
  metadata: unknown;
}

export interface AuditLogPage {
  rows: AuditLogRow[];
  /** 有下一頁時的游標（已編碼字串，供 URL 帶入）；否則 null。 */
  nextCursor: string | null;
}

/**
 * 過濾條件建構。`cursor` 給定時追加 (created_at, id) < (cursor) 以取「更舊」的下一頁
 * （排序為 created_at DESC, id DESC）。actor 搜尋需 leftJoin users 後比對名稱／email。
 */
function buildConditions(filter: AuditFilter, cursor: AuditCursor | null): SQL[] {
  const conditions: SQL[] = [];

  if (filter.actions && filter.actions.length > 0) {
    conditions.push(inArray(auditLogs.action, filter.actions));
  }
  if (filter.from) conditions.push(gte(auditLogs.createdAt, filter.from));
  if (filter.to) conditions.push(lte(auditLogs.createdAt, filter.to));

  if (filter.actorQuery && filter.actorQuery.trim() !== "") {
    const pattern = `%${escapeLike(filter.actorQuery.trim())}%`;
    const actorMatch = or(ilike(users.name, pattern), ilike(users.email, pattern));
    if (actorMatch) conditions.push(actorMatch);
  }

  if (cursor) {
    // row-value 比較：以 (created_at, id) 元組嚴格小於游標，取更舊的資料。
    conditions.push(
      sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::bigint)`,
    );
  }

  return conditions;
}

/** LIKE 特殊字元轉義（% _ \），避免使用者輸入被當萬用字元。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** 共用查詢：依過濾條件＋游標，取最多 limit 列（created_at DESC, id DESC），左接 actor。 */
async function queryAuditRows(
  filter: AuditFilter,
  cursor: AuditCursor | null,
  limit: number,
): Promise<AuditLogRow[]> {
  const conditions = buildConditions(filter, cursor);
  const rows = await db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.actorId,
      actorName: users.name,
      actorEmail: users.email,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      ip: auditLogs.ip,
      metadata: auditLogs.metadata,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit);
  return rows;
}

/**
 * 取一頁稽核日誌（游標分頁）。多取一列判斷是否有下一頁：有則回傳最後一列的編碼游標。
 * @param pageSize 單頁列數（預設 AUDIT_PAGE_SIZE）
 */
export async function listAuditLogs(
  filter: AuditFilter,
  cursor: AuditCursor | null = null,
  pageSize: number = AUDIT_PAGE_SIZE,
): Promise<AuditLogPage> {
  const rows = await queryAuditRows(filter, cursor, pageSize + 1);
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
  return { rows: page, nextCursor };
}

/** 目前日誌中出現過的 action 清單（升冪）——供過濾列的 action 多選填充。 */
export async function listAuditActions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLogs.action })
    .from(auditLogs)
    .orderBy(auditLogs.action);
  return rows.map((r) => r.action);
}

/** 從 URL 查詢字串解析過濾條件（page 與 CSV route 共用，確保兩者過濾一致）。 */
export function parseAuditFilter(get: (key: string) => string | null): AuditFilter {
  const filter: AuditFilter = {};

  const actionsRaw = get("actions");
  if (actionsRaw) {
    const actions = actionsRaw
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    if (actions.length > 0) filter.actions = actions;
  }

  const actor = get("actor");
  if (actor && actor.trim() !== "") filter.actorQuery = actor.trim();

  const from = parseDateParam(get("from"));
  if (from) filter.from = from;
  const to = parseDateParam(get("to"));
  if (to) filter.to = to;

  return filter;
}

/** 解析時間參數（datetime-local／ISO）；無效回 null。 */
function parseDateParam(value: string | null): Date | null {
  if (!value || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 游標編碼為 URL 安全字串（base64url of `${iso}|${id}`）。 */
export function encodeCursor(cursor: AuditCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, "utf8").toString("base64url");
}

/** 解析游標字串；格式錯誤／無效時回 null（視同無游標，退回首頁）。 */
export function decodeCursor(value: string | null | undefined): AuditCursor | null {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const sep = decoded.lastIndexOf("|");
    if (sep <= 0) return null;
    const iso = decoded.slice(0, sep);
    const id = Number(decoded.slice(sep + 1));
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !Number.isInteger(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// ── CSV 匯出 ────────────────────────────────────────────────────────────

/** CSV 儲存格轉義：含逗號／引號／換行者加引號並跳脫；防公式注入（Excel/Sheets）。 */
function csvCell(value: string | null | undefined): string {
  const raw = value == null ? "" : String(value);
  // 以 = + - @ Tab CR 開頭者前置單引號，避免被試算表當公式執行（CSV injection）。
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

/** 單列 → CSV 欄位（順序須與匯出 header 對齊）。 */
function toCsvCells(row: AuditLogRow): string[] {
  return [
    row.createdAt.toISOString(),
    row.actorName ?? "",
    row.actorEmail ?? "",
    row.action,
    row.targetType,
    row.targetId ?? "",
    row.ip ?? "",
    row.metadata == null ? "" : JSON.stringify(row.metadata),
  ];
}

/**
 * 串流匯出目前過濾條件下的稽核日誌 CSV（F-ADMIN-05：上限 10k 列）。
 * 以游標分批（每批 CSV_BATCH_SIZE 列）往前推，逐批 yield，避免一次撈 10k 列進記憶體。
 * 首段輸出 UTF-8 BOM ＋ header（Excel 正確辨識中文）。
 * @param headerLabels 已在地化的欄位標題（順序須對齊 toCsvCells）
 */
export async function* streamAuditCsv(
  filter: AuditFilter,
  headerLabels: string[],
): AsyncGenerator<string> {
  yield `﻿${headerLabels.map(csvCell).join(",")}\r\n`;

  let cursor: AuditCursor | null = null;
  let emitted = 0;
  while (emitted < MAX_CSV_ROWS) {
    const batchLimit = Math.min(CSV_BATCH_SIZE, MAX_CSV_ROWS - emitted);
    const rows = await queryAuditRows(filter, cursor, batchLimit);
    if (rows.length === 0) break;

    let chunk = "";
    for (const row of rows) {
      chunk += `${toCsvCells(row).map(csvCell).join(",")}\r\n`;
    }
    yield chunk;

    emitted += rows.length;
    if (rows.length < batchLimit) break;
    const last = rows[rows.length - 1]!;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}
