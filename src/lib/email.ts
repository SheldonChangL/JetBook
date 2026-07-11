import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Email 寄送（B-05）。SMTP_* 為選配基礎設施：
 * - 設定 SMTP_HOST → 以 nodemailer 走真 SMTP 寄出。
 * - 未設定 SMTP_HOST（本機開發／CI）→ 不寄信，改以 logger.info 輸出信件內容（含重設連結）
 *   供開發者手動取用；生產環境務必設定 SMTP_*。
 *
 * 抽象在此層而非散於呼叫端：未來換供應商（SES/Postmark）只需改本檔。
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** undefined＝尚未初始化；null＝SMTP 未設定（走 log fallback）。 */
let cachedTransporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (cachedTransporter !== undefined) return cachedTransporter;
  if (!env.SMTP_HOST) {
    cachedTransporter = null;
    return null;
  }
  cachedTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  });
  return cachedTransporter;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    // SMTP 未設定 fallback：輸出內容供開發用（body 含連結；生產環境請設定 SMTP_*）
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      "SMTP 未設定：Email 未寄出，於 log 輸出內容（僅供開發）",
    );
    return;
  }
  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });
}
