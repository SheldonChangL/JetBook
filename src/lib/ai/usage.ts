import "server-only";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { metrics } from "@/lib/metrics/registry";

/**
 * AI 用量記錄（I-06，NFR-OBS-04／NFR-SEC-06）。
 *
 * 每次實際發生的 AI 呼叫（LLM 生成或 embedding 檢索）後，寫一筆 `ai.query`
 * 稽核事件到 audit_logs（已存在的表，不需 migration）。集中在此定義 metadata 形狀，
 * 讓「用量可按使用者／功能分項查詢」有一致 schema：
 * - actorId：發起查詢的使用者 → 依使用者分項。
 * - metadata.mode：AI 功能別（chat／semantic／hybrid）→ 依功能分項。
 * - metadata.model / inputTokens / outputTokens / latencyMs：成本與濫用監控（NFR-OBS-04）。
 *
 * writeAudit 內部吞例外（稽核失敗不中斷主流程），故本函式亦不擲出。
 */

/**
 * AI 查詢稽核事件動作。此模組為 `ai.query` 事件的產生端；用量聚合（L-03）與
 * 每日配額計數（I-09）皆以此常數比對，集中定義避免字串漂移。
 */
export const AI_QUERY_AUDIT_ACTION = "ai.query";

/** AI 查詢功能別（對應 audit metadata.mode，供用量分項統計）。 */
export type AiQueryMode = "chat" | "assist" | "semantic" | "hybrid";

export interface AiUsageRecord {
  /** 發起查詢的使用者 id。 */
  actorId: string;
  /** 實際使用的 model id（LLM 或 embedding 模型）。 */
  model: string;
  /** 輸入 token 數（embedding 檢索無 token 計費時為 0）。 */
  inputTokens: number;
  /** 輸出 token 數（僅 chat 生成有值；檢索為 0）。 */
  outputTokens: number;
  /** 端到端延遲（毫秒）。 */
  latencyMs: number;
  /** AI 功能別。 */
  mode: AiQueryMode;
  /** 來源 IP（proxy 之後由 ipFromHeaders 解析）。 */
  ip?: string | null;
}

/** 寫入一筆 AI 用量稽核（action=`ai.query`，targetType=`ai`）並同步 Prometheus 即時指標。 */
export async function recordAiUsage(record: AiUsageRecord): Promise<void> {
  // 即時指標（NFR-OBS-03/04）：與稽核同源，供成本／濫用監控在抓取端聚合（不含 user label，避免高基數）。
  // best-effort：指標更新失敗不得破壞「本函式不擲出」契約，亦不得擋下稽核寫入。
  try {
    metrics.llmRequestsTotal.inc({ mode: record.mode, model: record.model });
    metrics.llmTokensTotal.inc({ direction: "input", model: record.model }, record.inputTokens);
    metrics.llmTokensTotal.inc({ direction: "output", model: record.model }, record.outputTokens);
    metrics.llmRequestDuration.observe({ mode: record.mode, model: record.model }, record.latencyMs / 1000);
  } catch (error) {
    logger.warn({ err: error, model: record.model }, "llm metrics 更新失敗（不中斷用量記錄）");
  }

  await writeAudit({
    actorId: record.actorId,
    action: AI_QUERY_AUDIT_ACTION,
    targetType: "ai",
    metadata: {
      model: record.model,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      latencyMs: record.latencyMs,
      mode: record.mode,
    },
    ip: record.ip ?? null,
  });
}
