"use server";

import { requireSession } from "@/lib/auth/current";
import { markAllRead } from "@/lib/notifications";
import { logger } from "@/lib/logger";

/**
 * 站內通知 Server Actions（K-02，架構鐵律 #6 薄殼）：
 * 驗 session → 呼叫 lib/notifications。通知天生綁定 user_id，資料層一律以 user.id
 * 收斂，無跨使用者操作面，故不需額外 authz 判斷。
 */

/** 將目前使用者的全部未讀通知標為已讀。 */
export async function markAllNotificationsRead(): Promise<void> {
  const { user } = await requireSession();
  await markAllRead(user.id);
  logger.info({ userId: user.id }, "notifications marked all read");
}
