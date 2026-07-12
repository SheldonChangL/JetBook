import "server-only";
import { metrics } from "./registry";

/**
 * HTTP 指標蒐集（N-05，NFR-OBS-03）。
 *
 * Next App Router（Node runtime）無全域「回應後」勾點，middleware 又跑在 edge runtime
 * 不能用 prom-client；因此以 route handler 包裝計數（issue 指定作法）：`withMetrics`
 * 量測單一 handler 從進入到回傳 Response 的耗時與狀態碼，記入 http 延遲直方圖。
 *
 * route label 由呼叫端明確傳入「路由樣板」（如 `/api/files/[id]`）而非實際 URL，
 * 避免把 id 之類高基數值當 label 造成序列爆炸。
 */

/** 標準化 method（大寫、限已知動詞，未知歸 OTHER，避免 label 基數失控）。 */
const KNOWN_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
function normalizeMethod(method: string): string {
  const upper = method.toUpperCase();
  return KNOWN_METHODS.has(upper) ? upper : "OTHER";
}

/** 直接記錄一次 HTTP 請求觀測（供 withMetrics 使用，或需自訂量測點時呼叫）。 */
export function observeHttpRequest(params: {
  method: string;
  route: string;
  status: number;
  durationSeconds: number;
}): void {
  metrics.httpRequestDuration.observe(
    {
      method: normalizeMethod(params.method),
      route: params.route,
      status: String(params.status),
    },
    params.durationSeconds,
  );
}

/**
 * 包裝 route handler：量測延遲與狀態碼後透傳原 Response（不消耗其 body，串流不受影響）。
 * handler 擲例外時記為 status 500 再原樣拋出，交回 Next 的錯誤處理（行為不變）。
 *
 * 保留原 handler 的額外參數（如 `{ params }` context），型別上原樣轉發。
 */
export function withMetrics<Args extends unknown[]>(
  route: string,
  handler: (request: Request, ...args: Args) => Response | Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request: Request, ...args: Args): Promise<Response> => {
    const startedAt = performance.now();
    try {
      const response = await handler(request, ...args);
      observeHttpRequest({
        method: request.method,
        route,
        status: response.status,
        durationSeconds: (performance.now() - startedAt) / 1000,
      });
      return response;
    } catch (error) {
      observeHttpRequest({
        method: request.method,
        route,
        status: 500,
        durationSeconds: (performance.now() - startedAt) / 1000,
      });
      throw error;
    }
  };
}
