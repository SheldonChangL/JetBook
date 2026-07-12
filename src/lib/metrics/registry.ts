import "server-only";
import client from "prom-client";
import { env } from "@/lib/env";

/**
 * Prometheus 指標登錄中心（N-05，NFR-OBS-03/04）。
 *
 * - 單一 Registry 承載本服務所有指標；`/api/metrics` route handler 讀取後輸出 prom 文字格式。
 * - dev 模式 HMR 會重複評估模組、`next build` 也可能多次載入——以 globalThis 快取整組指標，
 *   避免「metric 已註冊」重複例外與計數器歸零。
 * - process 預設指標（process_ 與 nodejs_ 系列）由 collectDefaultMetrics 提供；
 *   應用層指標（HTTP／LLM）在此集中定義，各採 `jetbook_` 前綴。
 * - 測試環境跳過 collectDefaultMetrics：其事件迴圈延遲監測會持有 libuv handle，
 *   會干擾 vitest 收尾；單元測試只驗應用層指標，不需 process 指標。
 */

/** HTTP 請求延遲直方圖桶（秒）：涵蓋亞毫秒級快取命中到十秒級慢請求。 */
const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/** LLM 呼叫延遲直方圖桶（秒）：生成／檢索普遍比一般 HTTP 久，桶上限拉高到 60s。 */
const LLM_DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];

export interface Metrics {
  registry: client.Registry;
  /** HTTP 請求延遲/狀態碼（label：method / route / status）。 */
  httpRequestDuration: client.Histogram<"method" | "route" | "status">;
  /** LLM 呼叫次數（label：mode / model）。 */
  llmRequestsTotal: client.Counter<"mode" | "model">;
  /** LLM token 累計用量（label：direction=input|output / model）。 */
  llmTokensTotal: client.Counter<"direction" | "model">;
  /** LLM 呼叫延遲（label：mode / model）。 */
  llmRequestDuration: client.Histogram<"mode" | "model">;
}

function build(): Metrics {
  const registry = new client.Registry();
  registry.setDefaultLabels({ app: "jetbook" });

  // process/node 預設指標（記憶體、CPU、GC、event loop…）；測試環境跳過避免殘留 handle。
  if (env.NODE_ENV !== "test") {
    client.collectDefaultMetrics({ register: registry });
  }

  const httpRequestDuration = new client.Histogram({
    name: "jetbook_http_request_duration_seconds",
    help: "HTTP 請求延遲（秒），依 method/route/status 分項（NFR-OBS-03）。",
    labelNames: ["method", "route", "status"] as const,
    buckets: HTTP_DURATION_BUCKETS,
    registers: [registry],
  });

  const llmRequestsTotal = new client.Counter({
    name: "jetbook_llm_requests_total",
    help: "LLM／embedding 呼叫次數，依功能別 mode 與 model 分項（NFR-OBS-04）。",
    labelNames: ["mode", "model"] as const,
    registers: [registry],
  });

  const llmTokensTotal = new client.Counter({
    name: "jetbook_llm_tokens_total",
    help: "LLM token 累計用量，依 direction（input/output）與 model 分項（NFR-OBS-04）。",
    labelNames: ["direction", "model"] as const,
    registers: [registry],
  });

  const llmRequestDuration = new client.Histogram({
    name: "jetbook_llm_request_duration_seconds",
    help: "LLM／embedding 呼叫延遲（秒），依功能別 mode 與 model 分項（NFR-OBS-04）。",
    labelNames: ["mode", "model"] as const,
    buckets: LLM_DURATION_BUCKETS,
    registers: [registry],
  });

  return {
    registry,
    httpRequestDuration,
    llmRequestsTotal,
    llmTokensTotal,
    llmRequestDuration,
  };
}

const globalForMetrics = globalThis as unknown as { jetbookMetrics?: Metrics };

/** 單例指標組（跨 HMR／多次載入共用同一 Registry）。 */
export const metrics: Metrics = globalForMetrics.jetbookMetrics ?? (globalForMetrics.jetbookMetrics = build());

/** 供 route handler 直接輸出的 Registry。 */
export const registry = metrics.registry;
