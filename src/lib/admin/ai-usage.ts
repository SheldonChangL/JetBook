import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

/**
 * AI 用量統計聚合（L-03，F-ADMIN-04；NFR-OBS-04）。
 *
 * 用量記錄由 I-06（#82）以 `ai.query` 稽核事件寫入 `audit_logs`，metadata 帶
 * `inputTokens`／`outputTokens`（數值）。本模組唯讀聚合——只讀不寫，供後台用量卡顯示。
 * 分日以 Asia/Taipei 曆日切桶（內部工具、使用者皆在台灣）。
 */

/** AI 問答用量稽核事件動作（I-06 寫入端與本聚合端共用，避免字串漂移）。 */
export const AI_QUERY_AUDIT_ACTION = "ai.query";

const TIMEZONE = "Asia/Taipei";
const MS_PER_DAY = 86_400_000;

export interface AiUsageDay {
  /** 曆日（Asia/Taipei），格式 YYYY-MM-DD */
  date: string;
  /** 當日 AI 問答次數 */
  count: number;
  /** 當日 token 總量（input + output） */
  tokens: number;
}

export interface AiUsageSummary {
  /** 統計涵蓋的天數 */
  rangeDays: number;
  /** 連續日序列（升冪；缺漏日補 0），長度＝rangeDays */
  days: AiUsageDay[];
  /** 期間總次數 */
  totalCount: number;
  /** 期間總 token 量 */
  totalTokens: number;
}

/** 以 Asia/Taipei 曆日格式化 instant 為 YYYY-MM-DD（en-CA 產出即為此格式）。 */
function formatTaipeiDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(instant);
}

/**
 * 近 `rangeDays` 日 AI 問答用量：按曆日聚合次數與 token（`ai.query` 稽核事件）。
 * 回傳連續日序列（缺漏日補 0），總計由序列加總以與圖表一致。
 * @param rangeDays 統計天數（含今日；1–365，預設 30）
 */
export async function getAiUsageDaily(rangeDays = 30): Promise<AiUsageSummary> {
  const days = Math.max(1, Math.min(365, Math.floor(rangeDays)));

  // 序列最早一天（Asia/Taipei 曆日）的字串；SQL 以其台北午夜為下界。
  const earliestDate = formatTaipeiDate(new Date(Date.now() - (days - 1) * MS_PER_DAY));

  const rows = await db
    .select({
      day: sql<string>`to_char((${auditLogs.createdAt} AT TIME ZONE ${TIMEZONE})::date, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      tokens: sql<number>`
        coalesce(sum(
          coalesce((${auditLogs.metadata} ->> 'inputTokens')::int, 0)
          + coalesce((${auditLogs.metadata} ->> 'outputTokens')::int, 0)
        ), 0)::int
      `,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, AI_QUERY_AUDIT_ACTION),
        // 下界＝earliestDate 的台北午夜（naive date → timestamp → 以台北時區解讀為 instant）。
        gte(
          auditLogs.createdAt,
          sql<Date>`(${earliestDate}::date)::timestamp AT TIME ZONE ${TIMEZONE}`,
        ),
      ),
    )
    .groupBy(sql`1`);

  const byDate = new Map(rows.map((row) => [row.day, row]));

  const series: AiUsageDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = formatTaipeiDate(new Date(Date.now() - i * MS_PER_DAY));
    const row = byDate.get(date);
    series.push({ date, count: row?.count ?? 0, tokens: row?.tokens ?? 0 });
  }

  const totalCount = series.reduce((acc, day) => acc + day.count, 0);
  const totalTokens = series.reduce((acc, day) => acc + day.tokens, 0);

  return { rangeDays: days, days: series, totalCount, totalTokens };
}
