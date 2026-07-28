import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";
import type { EmailMessage } from "./types";

/**
 * SMTP provider（B-05）。部署環境封鎖 SMTP 埠（見 ADR-015），故生產改走 Graph；
 * 本檔保留供本機開發與能直連 SMTP 的環境使用。
 */

/** undefined＝尚未初始化 */
let cachedTransporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;
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

export async function sendViaSmtp(message: EmailMessage): Promise<void> {
  await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });
}
