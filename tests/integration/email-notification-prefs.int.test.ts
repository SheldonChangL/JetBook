import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { updateEmailNotificationPref } from "@/lib/auth/account";
import { isEmailNotificationEnabled } from "@/lib/notifications-email";
import { seedUser } from "./helpers";

/** M4-05 Email 通知偏好整合測試（真 PG）：jsonb merge、預設全開、關閉後判斷為停用。 */

describe("Email 通知偏好（M4-05，issue #196）", () => {
  it("預設（null）全類型啟用；關閉單一類型不影響其他類型", async () => {
    const user = await seedUser();
    expect(isEmailNotificationEnabled(user.emailNotificationPrefs, "comment_reply")).toBe(true);

    await updateEmailNotificationPref(user.id, "comment_reply", false);
    const after = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(isEmailNotificationEnabled(after?.emailNotificationPrefs, "comment_reply")).toBe(false);
    expect(isEmailNotificationEnabled(after?.emailNotificationPrefs, "page_mention")).toBe(true);
  });

  it("重新開啟後恢復寄送判斷", async () => {
    const user = await seedUser();
    await updateEmailNotificationPref(user.id, "page_mention", false);
    await updateEmailNotificationPref(user.id, "page_mention", true);
    const after = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(isEmailNotificationEnabled(after?.emailNotificationPrefs, "page_mention")).toBe(true);
  });
});
