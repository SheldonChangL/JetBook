import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, orgSettings } from "@/lib/db/schema";
import { AI_QUERY_AUDIT_ACTION } from "@/lib/ai/usage";

/**
 * AI 每人每日查詢配額（I-09，F-AI-11）。
 *
 * 配額值存於單列 `org_settings.ai_daily_quota_per_user`（null＝不限）。已用量以當日
 * `ai.query` 稽核事件計數推得（與 L-03 用量聚合同一資料來源），因此配額只計「實際發生的
 * AI 呼叫」，與限流（NFR-SEC-07）互補：限流擋短時暴衝，配額擋單日累計濫用。
 *
 * 曆日邊界採 Asia/Taipei（內部工具、使用者皆在台灣），與 lib/admin/ai-usage 一致。
 * 強制點在 /api/ai/chat（薄殼呼叫 checkAiDailyQuota）；設定寫入端在後台 server action。
 */

const TIMEZONE = "Asia/Taipei";
const ORG_SETTINGS_ID = 1;

/** 以 Asia/Taipei 曆日格式化 instant 為 YYYY-MM-DD（en-CA 產出即為此格式）。 */
function formatTaipeiDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(instant);
}

/** 讀取全域 AI 每人每日配額；無設定列或欄位為 null 皆視為不限（回 null）。 */
export async function getAiDailyQuotaPerUser(): Promise<number | null> {
  const [row] = await db
    .select({ quota: orgSettings.aiDailyQuotaPerUser })
    .from(orgSettings)
    .where(eq(orgSettings.id, ORG_SETTINGS_ID))
    .limit(1);
  return row?.quota ?? null;
}

/**
 * 設定全域 AI 每人每日配額（null＝不限）。org_settings 為單列表（id=1）：
 * upsert 確保設定列不存在時建立、存在時更新，並同步 updatedAt。
 */
export async function setAiDailyQuotaPerUser(quota: number | null): Promise<void> {
  await db
    .insert(orgSettings)
    .values({ id: ORG_SETTINGS_ID, aiDailyQuotaPerUser: quota })
    .onConflictDoUpdate({
      target: orgSettings.id,
      set: { aiDailyQuotaPerUser: quota, updatedAt: new Date() },
    });
}

/** 某使用者當日（Asia/Taipei 曆日）已發生的 `ai.query` 次數。 */
export async function countAiQueriesToday(actorId: string): Promise<number> {
  const todayDate = formatTaipeiDate(new Date());
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, AI_QUERY_AUDIT_ACTION),
        eq(auditLogs.actorId, actorId),
        // 下界＝今日（台北）午夜：naive date → timestamp → 以台北時區解讀為 instant。
        gte(auditLogs.createdAt, sql<Date>`(${todayDate}::date)::timestamp AT TIME ZONE ${TIMEZONE}`),
      ),
    );
  return row?.count ?? 0;
}

/** 配額檢查結果。`quota` 為 null 代表不限；`used` 為當日已用次數。 */
export interface AiDailyQuotaCheck {
  /** 是否已達或超過配額（達額即拒，故為 used >= quota）。 */
  exceeded: boolean;
  /** 當前配額（null＝不限）。 */
  quota: number | null;
  /** 當日已用次數（不限時為 0，不做多餘計數）。 */
  used: number;
}

/**
 * 檢查使用者當日是否已達 AI 配額。不限（null）時直接放行、不查計數；
 * 有配額時計當日 `ai.query` 次數，達額（>=）即回 exceeded。
 */
export async function checkAiDailyQuota(actorId: string): Promise<AiDailyQuotaCheck> {
  const quota = await getAiDailyQuotaPerUser();
  if (quota === null) return { exceeded: false, quota: null, used: 0 };
  const used = await countAiQueriesToday(actorId);
  return { exceeded: used >= quota, quota, used };
}
