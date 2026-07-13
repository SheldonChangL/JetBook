import "server-only";
import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { enqueueNotificationEmail } from "@/lib/jobs/queue";
import type { NotificationPayload, NotificationType } from "@/lib/notifications";
import messages from "../../messages/zh-TW.json";

/**
 * 站內通知 → Email 鏡射（M4-05，F-NOTIF-02）。
 * - 偏好判斷與組信在 enqueue 端（createTranslator 不依賴請求上下文，web/worker 皆可用）；
 *   worker 只負責寄送與重試。
 * - 全程 best-effort：任何失敗僅記 warn，絕不中斷通知主流程（比照 notify 本身）。
 */

/** 缺鍵或 null＝啟用（預設全開）；明確 false 才停用。 */
export function isEmailNotificationEnabled(
  prefs: Record<string, boolean> | null | undefined,
  type: NotificationType,
): boolean {
  return prefs?.[type] !== false;
}

const translator = createTranslator({ locale: "zh-TW", messages, namespace: "email" });

/** 組通知信件（純函式，可單元測試）。url 轉為絕對連結。 */
export function composeNotificationEmail(
  type: NotificationType,
  payload: NotificationPayload,
): { subject: string; text: string } {
  const url = `${env.BASE_URL}${payload.url}`;
  const params = {
    actorName: payload.actorName ?? "",
    pageTitle: payload.pageTitle ?? "",
    excerpt: payload.excerpt ?? "",
    url,
  };
  if (type === "comment_reply") {
    return {
      subject: translator("notifyReplySubject", params),
      text: translator("notifyReplyBody", params),
    };
  }
  return {
    subject: translator("notifyMentionSubject", params),
    text: translator("notifyMentionBody", params),
  };
}

/**
 * 鏡射一則站內通知為 Email job：查收件人（啟用中＋該類型未停用）→ 組信 → enqueue。
 * 呼叫端 fire-and-forget；此處吞錯記 warn。
 */
export async function mirrorNotificationEmail(
  userId: string,
  type: NotificationType,
  payload: NotificationPayload,
): Promise<void> {
  try {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user || !user.isActive) return;
    if (!isEmailNotificationEnabled(user.emailNotificationPrefs, type)) return;
    const { subject, text } = composeNotificationEmail(type, payload);
    await enqueueNotificationEmail({ to: user.email, subject, text });
  } catch (error) {
    logger.warn({ error, userId, type }, "notification email enqueue failed");
  }
}
