import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkLlm, checkStorage, maskDatabaseUrl } from "./health";

describe("maskDatabaseUrl", () => {
  it("遮罩帳密，只留 host:port 與 db 名", () => {
    expect(maskDatabaseUrl("postgresql://user:s3cret@db.internal:5432/jetbook")).toBe(
      "postgresql://db.internal:5432/jetbook",
    );
  });

  it("無 port 時只顯示 host 與 db 名", () => {
    expect(maskDatabaseUrl("postgresql://user:pw@db.internal/jetbook")).toBe(
      "postgresql://db.internal/jetbook",
    );
  });

  it("輸出不得含帳號或密碼子字串", () => {
    const masked = maskDatabaseUrl("postgresql://jetbook:local-dev-password@127.0.0.1:5432/jetbook");
    expect(masked).not.toContain("local-dev-password");
    expect(masked).toBe("postgresql://127.0.0.1:5432/jetbook");
  });

  it("支援 HA 多主機連線字串並移除 query 參數", () => {
    const masked = maskDatabaseUrl(
      "postgresql://user:password@host1:5432,host2:5432/jetbook?sslmode=require",
    );
    expect(masked).toBe("postgresql://host1:5432,host2:5432/jetbook");
    expect(masked).not.toContain("password");
  });

  it("無 userinfo 時原樣保留 host 與 db 名", () => {
    expect(maskDatabaseUrl("postgresql://db.internal:5432/jetbook")).toBe(
      "postgresql://db.internal:5432/jetbook",
    );
  });

  it("無法解析時整串遮蔽", () => {
    expect(maskDatabaseUrl("not a url")).toBe("postgresql://***");
  });
});

describe("checkStorage", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("可寫目錄回 ok，且探測暫存檔已刪除", async () => {
    dir = await mkdtemp(join(tmpdir(), "jetbook-health-"));
    const result = await checkStorage(dir);
    expect(result.status).toBe("ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it("目錄不存在時自動建立並回 ok", async () => {
    dir = await mkdtemp(join(tmpdir(), "jetbook-health-"));
    const nested = join(dir, "not-yet", "uploads");
    const result = await checkStorage(nested);
    expect(result.status).toBe("ok");
    expect(await readdir(nested)).toEqual([]);
  });

  it("不可寫路徑回 error 並附原因", async () => {
    // /dev/null 是檔案，無法作為目錄建立子項 → 必定失敗
    const result = await checkStorage("/dev/null/uploads");
    expect(result.status).toBe("error");
    expect(result.detail).toBeTruthy();
  });
});

describe("checkLlm", () => {
  it("未設定 LLM_PROVIDER 時回 unconfigured（vitest env 未設定）", () => {
    expect(checkLlm()).toEqual({ status: "unconfigured" });
  });
});
