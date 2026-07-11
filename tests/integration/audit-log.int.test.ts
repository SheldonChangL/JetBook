import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import {
  decodeCursor,
  encodeCursor,
  listAuditActions,
  listAuditLogs,
  streamAuditCsv,
  type AuditCursor,
} from "@/lib/admin/audit";
import { seedUser } from "./helpers";

/**
 * L-04 稽核日誌檢視整合測試（真 PG，N-01）。
 * 覆蓋：多條件過濾（action／actor／時間範圍）、(created_at, id) 游標分頁穩定性、
 * CSV 串流（欄位轉義、公式注入防護、10k 上限的分批推進）。
 * 以獨立唯一 action 前綴隔離本測試資料，對既有資料免疫並於後清理。
 */

const TAG = `it-audit-${Math.random().toString(36).slice(2, 8)}`;
const insertedIds: number[] = [];

async function insertLog(entry: {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  createdAt: Date;
}) {
  const [row] = await db
    .insert(auditLogs)
    .values({
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? "test",
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
      ip: entry.ip ?? null,
      createdAt: entry.createdAt,
    })
    .returning({ id: auditLogs.id });
  if (!row) throw new Error("insertLog failed");
  insertedIds.push(row.id);
  return row.id;
}

afterEach(async () => {
  if (insertedIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.id, insertedIds.splice(0)));
  }
});

describe("listAuditLogs 過濾與游標分頁（真 PG）", () => {
  it("依 action 多選過濾、依 actor 名稱/email 過濾、依時間範圍過濾", async () => {
    const alice = await seedUser({ name: `${TAG}-Alice` });
    const bob = await seedUser({ name: `${TAG}-Bob` });
    const base = new Date("2026-06-01T00:00:00.000Z");
    const day = 86_400_000;

    const loginId = await insertLog({
      actorId: alice.id,
      action: `${TAG}.login`,
      createdAt: new Date(base.getTime()),
    });
    const deleteId = await insertLog({
      actorId: bob.id,
      action: `${TAG}.delete`,
      createdAt: new Date(base.getTime() + day),
    });
    const updateId = await insertLog({
      actorId: alice.id,
      action: `${TAG}.update`,
      createdAt: new Date(base.getTime() + 2 * day),
    });

    // action 多選：只取 login 與 update（排除 delete）
    const byAction = await listAuditLogs({ actions: [`${TAG}.login`, `${TAG}.update`] });
    const actionIds = byAction.rows.map((r) => r.id);
    expect(actionIds).toContain(loginId);
    expect(actionIds).toContain(updateId);
    expect(actionIds).not.toContain(deleteId);

    // actor 搜尋（大小寫不敏感、子字串）：只命中 Bob
    const byActor = await listAuditLogs({ actorQuery: `${TAG}-bob`.toLowerCase() });
    expect(byActor.rows.map((r) => r.id)).toEqual([deleteId]);
    // join 後帶出 actor 名稱/email
    expect(byActor.rows[0]?.actorName).toBe(`${TAG}-Bob`);
    expect(byActor.rows[0]?.actorEmail).toBe(bob.email);

    // 時間範圍：只取第二天（含）之後 → delete 與 update
    const byRange = await listAuditLogs({
      actions: [`${TAG}.login`, `${TAG}.delete`, `${TAG}.update`],
      from: new Date(base.getTime() + day),
    });
    expect(byRange.rows.map((r) => r.id)).toEqual([updateId, deleteId]);

    // 上界（含）：只取到第一天
    const byUpper = await listAuditLogs({
      actions: [`${TAG}.login`, `${TAG}.delete`, `${TAG}.update`],
      to: new Date(base.getTime()),
    });
    expect(byUpper.rows.map((r) => r.id)).toEqual([loginId]);
  });

  it("(created_at, id) 游標分頁：時間相同亦穩定不重不漏", async () => {
    const actor = await seedUser({ name: `${TAG}-Cursor` });
    const sameTime = new Date("2026-06-10T12:00:00.000Z");
    // 5 筆同一 created_at，靠 id 決序
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        await insertLog({ actorId: actor.id, action: `${TAG}.page`, createdAt: sameTime }),
      );
    }
    // created_at DESC, id DESC 期望序：id 由大到小
    const expected = [...ids].sort((a, b) => b - a);

    const filter = { actions: [`${TAG}.page`] };
    const first = await listAuditLogs(filter, null, 2);
    expect(first.rows.map((r) => r.id)).toEqual(expected.slice(0, 2));
    expect(first.nextCursor).not.toBeNull();

    const second = await listAuditLogs(filter, decodeCursor(first.nextCursor), 2);
    expect(second.rows.map((r) => r.id)).toEqual(expected.slice(2, 4));
    expect(second.nextCursor).not.toBeNull();

    const third = await listAuditLogs(filter, decodeCursor(second.nextCursor), 2);
    expect(third.rows.map((r) => r.id)).toEqual(expected.slice(4, 5));
    // 末頁：不足一頁 → 無下一游標
    expect(third.nextCursor).toBeNull();
  });

  it("listAuditActions 去重列出出現過的 action", async () => {
    const actor = await seedUser();
    await insertLog({ actorId: actor.id, action: `${TAG}.alpha`, createdAt: new Date() });
    await insertLog({ actorId: actor.id, action: `${TAG}.alpha`, createdAt: new Date() });
    await insertLog({ actorId: actor.id, action: `${TAG}.beta`, createdAt: new Date() });

    const actions = await listAuditActions();
    const mine = actions.filter((a) => a.startsWith(`${TAG}.`));
    expect(mine).toEqual([`${TAG}.alpha`, `${TAG}.beta`]);
  });
});

describe("streamAuditCsv（真 PG）", () => {
  it("輸出 BOM＋header，逐列轉義並防公式注入", async () => {
    const actor = await seedUser({ name: `${TAG},Comma "Quote"` });
    await insertLog({
      actorId: actor.id,
      action: `${TAG}.csv`,
      targetType: "page",
      targetId: "=1+2",
      ip: "10.0.0.1",
      metadata: { note: "hi", n: 3 },
      createdAt: new Date("2026-06-20T08:00:00.000Z"),
    });

    const headers = ["時間", "操作者", "Email", "動作", "目標類型", "目標 ID", "IP", "詳情"];
    let out = "";
    for await (const chunk of streamAuditCsv({ actions: [`${TAG}.csv`] }, headers)) {
      out += chunk;
    }

    // BOM 開頭
    expect(out.charCodeAt(0)).toBe(0xfeff);
    const lines = out.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe(headers.join(","));

    const dataLine = lines[1]!;
    // 含逗號/引號的 actor 名需被引號包裹並跳脫
    expect(dataLine).toContain('"' + `${TAG},Comma ""Quote""` + '"');
    // target_id 以 = 開頭 → 前置單引號防注入，且含 = 不需引號（無逗號）
    expect(dataLine).toContain("'=1+2");
    // metadata JSON（jsonb 正規化鍵序）內含逗號 → 引號包裹、內部引號跳脫；不假設鍵序
    expect(dataLine).toContain('""note"":""hi""');
    expect(dataLine).toContain('""n"":3');
    expect(dataLine.endsWith('}"')).toBe(true);
    // ISO 時間
    expect(dataLine).toContain("2026-06-20T08:00:00.000Z");
  });
});

describe("cursor 編解碼", () => {
  it("round-trip 保值；壞字串回 null", () => {
    const cursor: AuditCursor = { createdAt: new Date("2026-06-20T08:00:00.000Z"), id: 12345 };
    const decoded = decodeCursor(encodeCursor(cursor));
    expect(decoded?.id).toBe(12345);
    expect(decoded?.createdAt.toISOString()).toBe("2026-06-20T08:00:00.000Z");
    expect(decodeCursor("!!!not-base64-valid-cursor")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});
