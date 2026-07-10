import "server-only";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

/**
 * 稽核日誌（B-07，Must/P0）。
 *
 * - append-only：只有 writeAudit 這一條寫入路徑，無更新/刪除 API。
 * - 一般使用者不可讀寫：不經任何 Server Action / Route Handler 暴露；
 *   讀取介面留給後台（L-02）並限 org admin。
 * - 保留策略：NFR-SEC-06 保留 1 年（清理排程由後台維運 task 接手）。
 */
export interface AuditEntry {
  /** 行為者 user id；匿名事件（如帳號不存在的登入失敗）為 null */
  actorId?: string | null;
  /** 事件動作（`<domain>.<verb>`），如 auth.login / space.create / page.delete */
  action: string;
  /** 目標資源類型，如 user / space / page */
  targetType: string;
  targetId?: string | null;
  /** 附加脈絡（jsonb）；禁止放密碼、token、文件全文 */
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * 寫入一筆稽核事件。**失敗不擲出**：稽核寫入失敗不得中斷主流程
 * （登入、刪頁等仍須完成），僅記 warn 供監控告警。
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
      ip: entry.ip ?? null,
    });
  } catch (error) {
    logger.warn({ error, action: entry.action }, "audit write failed");
  }
}

/** 從請求 headers 取 client IP（proxy 之後以 x-forwarded-for 第一段為準）。 */
export function ipFromHeaders(requestHeaders: { get(name: string): string | null }): string | null {
  return (
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip")
  );
}
