import "server-only";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createGraphMailer, graphConfigFromEnv, type GraphMailer } from "./graph";
import { sendViaSmtp } from "./smtp";
import type { EmailMessage } from "./types";

/**
 * Email 寄送統一入口（B-05；#280 加入 Graph provider）。
 *
 * provider 決定順序：
 * 1. `MAIL_PROVIDER` 明確指定者優先。
 * 2. 未指定但設了 `SMTP_HOST` → SMTP（維持既有部署行為不變）。
 * 3. 未指定但 `GRAPH_*` 齊備 → Graph。
 * 4. 皆未設定 → 不寄信，改以 logger 輸出信件內容（含連結）供本機開發取用。
 *
 * 兩者同時設定而未指定 `MAIL_PROVIDER` 的情況由 `lib/env.ts` 於載入時 fail-fast，
 * 不在此處以隱含優先序決定，避免部署誤用了預期外的 provider。
 *
 * 抽象在此層而非散於呼叫端：換供應商只需改本目錄，`sendEmail()` 的呼叫端不動。
 */

export type { EmailMessage };

export type MailProvider = "graph" | "smtp" | "none";

export function resolveMailProvider(): MailProvider {
  if (env.MAIL_PROVIDER) return env.MAIL_PROVIDER;
  if (env.SMTP_HOST) return "smtp";
  return graphConfigFromEnv() ? "graph" : "none";
}

let cachedGraphMailer: GraphMailer | undefined;

function getGraphMailer(): GraphMailer {
  if (cachedGraphMailer) return cachedGraphMailer;
  const config = graphConfigFromEnv();
  if (!config) {
    // env.ts 的 superRefine 已保證 MAIL_PROVIDER=graph 時設定齊備；此處僅收斂型別
    throw new Error("MAIL_PROVIDER=graph 但 GRAPH_* 設定不完整");
  }
  cachedGraphMailer = createGraphMailer(config);
  return cachedGraphMailer;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  switch (resolveMailProvider()) {
    case "graph":
      await getGraphMailer().sendMail(message);
      return;
    case "smtp":
      await sendViaSmtp(message);
      return;
    default:
      // 未設定任何 provider fallback：輸出內容供開發用（body 含連結；生產環境請設定 provider）
      logger.info(
        { to: message.to, subject: message.subject, body: message.text },
        "未設定寄信 provider：Email 未寄出，於 log 輸出內容（僅供開發）",
      );
  }
}
