import { describe, expect, it } from "vitest";
import { envSchema } from "./env";

/**
 * #280 寄信 provider 的設定驗證：不完整或語意不明的組合必須在載入期 fail-fast，
 * 而不是等到真的要寄信時才炸。
 */

const base = {
  BASE_URL: "http://localhost",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
};

const graph = {
  GRAPH_TENANT_ID: "tenant",
  GRAPH_CLIENT_ID: "client",
  GRAPH_CLIENT_SECRET: "secret",
  GRAPH_SENDER: "no-reply@example.com",
};

/** 取出所有 issue 訊息，方便斷言原因 */
function errorsOf(input: Record<string, string>): string[] {
  const result = envSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe("MAIL_PROVIDER 設定驗證", () => {
  it("皆未設定＝合法（走 log fallback）", () => {
    expect(errorsOf(base)).toEqual([]);
  });

  it("僅設 SMTP_HOST＝合法（維持既有部署行為）", () => {
    expect(errorsOf({ ...base, SMTP_HOST: "smtp.example.com" })).toEqual([]);
  });

  it("僅設 GRAPH_* 齊備＝合法", () => {
    expect(errorsOf({ ...base, ...graph })).toEqual([]);
  });

  it("MAIL_PROVIDER=graph 但 GRAPH_* 缺漏＝拒絕", () => {
    const errors = errorsOf({
      ...base,
      MAIL_PROVIDER: "graph",
      GRAPH_TENANT_ID: "tenant",
      GRAPH_CLIENT_ID: "client",
      // 缺 secret 與 sender
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("GRAPH_CLIENT_SECRET");
  });

  it("MAIL_PROVIDER=smtp 但未設 SMTP_HOST＝拒絕", () => {
    const errors = errorsOf({ ...base, MAIL_PROVIDER: "smtp" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("SMTP_HOST");
  });

  it("SMTP 與 Graph 都設定卻未指定 MAIL_PROVIDER＝拒絕（不以隱含優先序猜測）", () => {
    const errors = errorsOf({ ...base, ...graph, SMTP_HOST: "smtp.example.com" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("MAIL_PROVIDER");
  });

  it("兩套都設定但明確指定 graph＝合法", () => {
    expect(
      errorsOf({ ...base, ...graph, SMTP_HOST: "smtp.example.com", MAIL_PROVIDER: "graph" }),
    ).toEqual([]);
  });

  it("MAIL_PROVIDER 只接受 smtp／graph", () => {
    expect(errorsOf({ ...base, MAIL_PROVIDER: "sendgrid" })).not.toEqual([]);
  });
});
