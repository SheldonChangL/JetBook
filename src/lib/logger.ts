import "server-only";
import pino from "pino";
import { env } from "@/lib/env";

/**
 * 結構化日誌唯一入口：單行 JSON 輸出至 stdout（12-factor）。
 * 禁止記錄密碼、token、文件全文；常見敏感欄位一律 redact。
 */
export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "authorization",
      "*.authorization",
      "cookie",
      "*.cookie",
    ],
    censor: "[redacted]",
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

/** 以 request-id 綁定的子 logger（middleware 注入 x-request-id header）。 */
export function requestLogger(headers: Headers) {
  return logger.child({ requestId: headers.get("x-request-id") ?? undefined });
}
