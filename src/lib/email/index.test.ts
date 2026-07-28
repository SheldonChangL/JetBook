import { describe, expect, it } from "vitest";
import { resolveMailProvider, sendEmail } from "./index";

/**
 * #280 provider 決定與 fallback。單元測試環境未注入 SMTP_* 與 GRAPH_*
 * （見 vitest.config.ts 的最小 env 集合），故應落在 log fallback。
 */

describe("resolveMailProvider", () => {
  it("未設定任何 provider 時為 none", () => {
    expect(resolveMailProvider()).toBe("none");
  });
});

describe("sendEmail", () => {
  it("none 時不寄信也不拋錯（改由 logger 輸出，供本機開發取用連結）", async () => {
    await expect(
      sendEmail({ to: "user@example.com", subject: "主旨", text: "重設連結" }),
    ).resolves.toBeUndefined();
  });
});
