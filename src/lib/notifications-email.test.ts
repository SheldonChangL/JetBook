import { describe, expect, it } from "vitest";
import { composeNotificationEmail, isEmailNotificationEnabled } from "./notifications-email";

describe("isEmailNotificationEnabled（M4-05 偏好判斷）", () => {
  it("null/缺鍵＝啟用（預設全開）", () => {
    expect(isEmailNotificationEnabled(null, "comment_reply")).toBe(true);
    expect(isEmailNotificationEnabled(undefined, "page_mention")).toBe(true);
    expect(isEmailNotificationEnabled({}, "comment_reply")).toBe(true);
    expect(isEmailNotificationEnabled({ page_mention: false }, "comment_reply")).toBe(true);
  });

  it("明確 false 才停用；true 維持啟用", () => {
    expect(isEmailNotificationEnabled({ comment_reply: false }, "comment_reply")).toBe(false);
    expect(isEmailNotificationEnabled({ comment_reply: true }, "comment_reply")).toBe(true);
  });
});

describe("composeNotificationEmail（M4-05 組信）", () => {
  it("comment_reply：主旨含頁標題，內文含觸發者/摘要/絕對連結", () => {
    const { subject, text } = composeNotificationEmail("comment_reply", {
      url: "/s/eng/onboarding",
      actorName: "張三",
      pageTitle: "新人指南",
      excerpt: "歡迎加入！",
    });
    expect(subject).toContain("新人指南");
    expect(text).toContain("張三");
    expect(text).toContain("歡迎加入！");
    // BASE_URL（測試環境 http://localhost）+ 相對路徑 → 絕對連結
    expect(text).toContain("http://localhost/s/eng/onboarding");
  });

  it("page_mention：主旨含觸發者與頁標題", () => {
    const { subject, text } = composeNotificationEmail("page_mention", {
      url: "/s/eng/spec",
      actorName: "李四",
      pageTitle: "規格書",
    });
    expect(subject).toContain("李四");
    expect(subject).toContain("規格書");
    expect(text).toContain("http://localhost/s/eng/spec");
  });
});
